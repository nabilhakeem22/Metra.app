import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintApiKeyCore, revokeApiKeyCore } from '@/lib/api-keys/core';
import { resolveApiKey } from '@/lib/api-keys/resolve';
import type { OrgContext } from '@/lib/db/context';
import { removeMemberCore } from '@/lib/team/core';
import { closeExecutionFixture, ownerQuery } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Security batch 3, A3: removing a member revokes the API keys that member
// minted, in the removal's own transaction. A key resolves through its
// creator's LIVE membership, so before this a removed creator's key was only
// dormant and came back to life on a re-invite.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let otherOrgId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  otherOrgId = (await seedOrg({ owners: 1 })).orgId;
  orgIds.push(orgId, otherOrgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const ownerCtx = () => ctxFor(orgId, ownerId, 'owner');

async function mintKey(ctx: OrgContext, label: string): Promise<{ id: string; rawKey: string }> {
  const minted = await mintApiKeyCore(ctx, { label });
  if (!minted.ok || !minted.data) throw new Error(`mint refused: ${JSON.stringify(minted)}`);
  return { id: minted.data.id, rawKey: minted.data.rawKey };
}

async function addMember(org: string, userId: string, role: string): Promise<void> {
  await ownerQuery(`insert into public.memberships (org_id, user_id, role) values ($1, $2, $3)`, [org, userId, role]);
}

/** An admin of this studio AND of another one, with keys in both. */
async function adminWithKeys() {
  const adminId = randomUUID();
  await addMember(orgId, adminId, 'admin');
  await addMember(otherOrgId, adminId, 'admin');
  const adminCtx = ctxFor(orgId, adminId, 'admin');
  const live = [await mintKey(adminCtx, 'first'), await mintKey(adminCtx, 'second')];
  const revokedEarlier = await mintKey(adminCtx, 'revoked earlier');
  expect(await revokeApiKeyCore(adminCtx, revokedEarlier.id)).toMatchObject({ ok: true });
  const otherStudio = await mintKey(ctxFor(otherOrgId, adminId, 'admin'), 'other studio');
  return { adminId, live, revokedEarlier, otherStudio };
}

interface KeyStamp {
  revoked_at: Date | null;
  updated_at: Date;
}

async function stampOf(keyId: string): Promise<KeyStamp> {
  const [row] = await ownerQuery<KeyStamp>(`select revoked_at, updated_at from public.api_keys where id = $1`, [keyId]);
  return row;
}

/** What the resolver function itself answers for a raw key (null = no principal). */
async function resolverAnswer(rawKey: string): Promise<unknown> {
  const hash = createHash('sha256').update(rawKey).digest('hex');
  const [row] = await ownerQuery<{ data: unknown }>(`select public.app_api_key_by_hash($1) as data`, [hash]);
  return row.data;
}

describe('removeMemberCore revokes the keys the removed member created (AC1)', () => {
  it('stamps revoked_at and updated_at on each of his live keys, and leaves an earlier revoke its own stamp', async () => {
    const { adminId, live, revokedEarlier } = await adminWithKeys();
    const earlierStamp = await stampOf(revokedEarlier.id);

    expect(await removeMemberCore(ownerCtx(), adminId)).toMatchObject({ ok: true });

    for (const key of live) {
      const stamp = await stampOf(key.id);
      expect(stamp.revoked_at).not.toBeNull();
      expect(stamp.updated_at).toEqual(stamp.revoked_at);
    }
    expect(await stampOf(revokedEarlier.id)).toEqual(earlierStamp);
  });

  it('writes one audit row per revoked key, in the transaction that deletes the membership', async () => {
    const { adminId, live } = await adminWithKeys();
    await removeMemberCore(ownerCtx(), adminId);

    const keyRows = await ownerQuery<{ entity_id: string; action: string; actor_user_id: string; at: Date }>(
      `select entity_id, action, actor_user_id, at from public.audit_log
        where org_id = $1 and entity = 'api_key' and after ->> 'via' = 'member_removed' and entity_id = any($2::uuid[])`,
      [orgId, live.map((key) => key.id)],
    );
    expect(keyRows.map((row) => row.entity_id).sort()).toEqual(live.map((key) => key.id).sort());
    expect(keyRows.every((row) => row.action === 'update' && row.actor_user_id === ownerId)).toBe(true);

    // audit_log.at defaults to now(), the transaction's start: one value = one transaction.
    const [removal] = await ownerQuery<{ at: Date }>(
      `select at from public.audit_log
        where org_id = $1 and entity = 'membership' and action = 'delete' and before ->> 'user_id' = $2`,
      [orgId, adminId],
    );
    expect(keyRows.map((row) => row.at)).toEqual([removal.at, removal.at]);
  });

  // Not a proof of ORDER: a refusal rolls the whole transaction back, so this
  // holds wherever the revoke sits. It pins the outcome a studio relies on.
  it('a refused removal leaves every key live', async () => {
    const { adminId } = await adminWithKeys();
    const ownerKey = await mintKey(ownerCtx(), 'owner key');
    expect(await removeMemberCore(ctxFor(orgId, adminId, 'admin'), ownerId)).toEqual({ ok: false, error: 'owner_immutable' });
    expect((await stampOf(ownerKey.id)).revoked_at).toBeNull();
  });
});

describe('keys the removed member did not create here are untouched (AC2)', () => {
  it('a colleague key in this studio and his own key in another studio stay live and keep resolving', async () => {
    const { adminId, otherStudio } = await adminWithKeys();
    const colleagueKey = await mintKey(ownerCtx(), 'colleague');
    const before = { colleague: await stampOf(colleagueKey.id), otherStudio: await stampOf(otherStudio.id) };

    await removeMemberCore(ownerCtx(), adminId);

    expect(await stampOf(colleagueKey.id)).toEqual(before.colleague);
    expect(await stampOf(otherStudio.id)).toEqual(before.otherStudio);
    expect(await resolveApiKey(colleagueKey.rawKey)).toMatchObject({ orgId, userId: ownerId, role: 'owner' });
    expect(await resolveApiKey(otherStudio.rawKey)).toMatchObject({ orgId: otherOrgId, userId: adminId, role: 'admin' });
  });
});

describe('re-adding the removed member does not revive his old key (AC3)', () => {
  it('app_api_key_by_hash answers null after the removal and still null once he is a member again', async () => {
    const { adminId, live } = await adminWithKeys();
    const [key] = live;
    expect(await resolverAnswer(key.rawKey), 'live before the removal').toMatchObject({ key_id: key.id, role: 'admin' });

    await removeMemberCore(ownerCtx(), adminId);
    expect(await resolverAnswer(key.rawKey)).toBeNull();

    await addMember(orgId, adminId, 'viewer');
    expect(await resolverAnswer(key.rawKey)).toBeNull();
    expect(await resolveApiKey(key.rawKey)).toBeNull();
  });
});
