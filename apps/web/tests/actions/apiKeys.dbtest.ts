import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { mintApiKeyCore, revokeApiKeyCore } from '@/lib/api-keys/core';
import { listApiKeys } from '@/lib/api-keys/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('AC4 — api_keys stores only the hash; raw shown once', () => {
  it('mint returns the raw key once and persists only its sha256 hash + prefix', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    const res = await mintApiKeyCore(ctx, { label: 'CI' });
    expect(res.ok).toBe(true);
    const rawKey = res.data!.rawKey;
    expect(rawKey.startsWith('mtk_')).toBe(true);

    const rows = await raw.query<{
      token_hash: string;
      token_prefix: string;
      label: string;
    }>(`select token_hash, token_prefix, label from public.api_keys where org_id = '${orgId}'`);
    expect(rows).toHaveLength(1);
    // Stored hash equals sha256(raw); the raw key itself is nowhere in the row.
    expect(rows[0].token_hash).toBe(
      createHash('sha256').update(rawKey).digest('hex'),
    );
    expect(rows[0].token_hash).not.toBe(rawKey);
    expect(rows[0].token_prefix).toBe(rawKey.slice(0, 12));
    expect(rawKey).not.toContain(rows[0].token_hash);

    // The list surface never exposes the hash.
    const listed = await listApiKeys(ctx);
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0])).not.toContain('tokenHash');
    expect(JSON.stringify(listed[0])).not.toContain(rows[0].token_hash);
  });
});

describe('AC10 — mint/revoke gated to owner/admin', () => {
  it('owner and admin can mint; PM/viewer get forbidden', async () => {
    const { orgId, ownerIds, memberIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'admin' }, { role: 'project_manager' }, { role: 'viewer' }],
    });
    orgIds.push(orgId);
    const [adminId, pmId, viewerId] = memberIds;

    expect(
      (await mintApiKeyCore(ctxFor(orgId, ownerIds[0], 'owner'), { label: 'o' }))
        .ok,
    ).toBe(true);
    expect(
      (await mintApiKeyCore(ctxFor(orgId, adminId, 'admin'), { label: 'a' })).ok,
    ).toBe(true);

    expect(
      await mintApiKeyCore(ctxFor(orgId, pmId, 'project_manager'), { label: 'p' }),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await mintApiKeyCore(ctxFor(orgId, viewerId, 'viewer'), { label: 'v' }),
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('a non-owner/admin cannot revoke', async () => {
    const { orgId, ownerIds, memberIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'viewer' }],
    });
    orgIds.push(orgId);
    const minted = await mintApiKeyCore(ctxFor(orgId, ownerIds[0], 'owner'), {
      label: 'k',
    });
    expect(minted.ok).toBe(true);
    const [row] = await raw.query<{ id: string }>(
      `select id from public.api_keys where org_id = '${orgId}' limit 1`,
    );

    const res = await revokeApiKeyCore(
      ctxFor(orgId, memberIds[0], 'viewer'),
      row.id,
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });

    // The key is still live (not revoked).
    const [after] = await raw.query<{ revoked_at: string | null }>(
      `select revoked_at from public.api_keys where id = '${row.id}'`,
    );
    expect(after.revoked_at).toBeNull();
  });
});
