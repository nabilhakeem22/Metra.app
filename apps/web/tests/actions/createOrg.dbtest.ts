import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createOrgCore } from '@/lib/org/core';
import { closeFixture, ctxFor, raw, teardown } from './fixture';

const orgIds: string[] = [];

afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// Read the workspace's enabled_flows over the BYPASSRLS fixture connection.
async function enabledFlows(orgId: string): Promise<string[] | undefined> {
  const rows = await raw.query<{ enabled_flows: string[] }>(
    `select enabled_flows from public.workspace_entitlements where org_id = '${orgId}'`,
  );
  return rows[0]?.enabled_flows;
}

// The org's owning account id (null/undefined when the org was never created).
async function accountId(orgId: string): Promise<string | null | undefined> {
  const rows = await raw.query<{ account_id: string | null }>(
    `select account_id from public.organizations where id = '${orgId}'`,
  );
  return rows[0]?.account_id;
}

describe('createOrgCore', () => {
  it('creates org + owner membership + audit atomically', async () => {
    const orgId = randomUUID();
    const userId = randomUUID();
    orgIds.push(orgId);

    const res = await createOrgCore(ctxFor(orgId, userId, 'owner'), {
      nameEn: 'Acme Fit-out',
      city: 'Cairo',
    });
    expect(res.ok).toBe(true);

    // FK to organizations means a membership row implies the org exists.
    const members = await raw.memberships(orgId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ user_id: userId, role: 'owner' });
    expect(await raw.count('audit_log', orgId)).toBe(1);
  });

  it('rejects when no name is provided', async () => {
    const res = await createOrgCore(ctxFor(randomUUID(), randomUUID(), 'owner'), {});
    expect(res).toEqual({ ok: false, error: 'name_required' });
  });

  it('firmType interior enables the {interior} flow + provisions the workspace', async () => {
    const orgId = randomUUID();
    const userId = randomUUID();
    orgIds.push(orgId);

    const res = await createOrgCore(ctxFor(orgId, userId, 'owner'), {
      nameEn: 'Interior Co',
      firmType: 'interior',
    });
    expect(res.ok).toBe(true);

    // account + org + owner all landed, plus exactly one {interior} entitlement.
    expect(await accountId(orgId)).toBeTruthy();
    expect(await raw.memberships(orgId)).toHaveLength(1);
    expect(await raw.count('workspace_entitlements', orgId)).toBe(1);
    expect(await enabledFlows(orgId)).toEqual(['interior']);
  });

  it('defaults to {interior} when no firmType is supplied (existing-caller regression)', async () => {
    const orgId = randomUUID();
    orgIds.push(orgId);

    const res = await createOrgCore(ctxFor(orgId, randomUUID(), 'owner'), {
      nameEn: 'Legacy Caller',
    });
    expect(res.ok).toBe(true);
    expect(await enabledFlows(orgId)).toEqual(['interior']);
  });

  it('rejects firmType construction and writes zero rows (whole tx rolled back)', async () => {
    const orgId = randomUUID();
    orgIds.push(orgId);

    const res = await createOrgCore(ctxFor(orgId, randomUUID(), 'owner'), {
      nameEn: 'Builder Co',
      firmType: 'construction',
    });
    expect(res).toEqual({ ok: false, error: 'firm_type_unavailable' });

    expect(await accountId(orgId)).toBeUndefined();
    expect(await raw.memberships(orgId)).toHaveLength(0);
    expect(await raw.count('workspace_entitlements', orgId)).toBe(0);
    expect(await raw.count('audit_log', orgId)).toBe(0);
  });

  it('rejects firmType both and writes zero rows', async () => {
    const orgId = randomUUID();
    orgIds.push(orgId);

    const res = await createOrgCore(ctxFor(orgId, randomUUID(), 'owner'), {
      nameEn: 'Everything Co',
      firmType: 'both',
    });
    expect(res).toEqual({ ok: false, error: 'firm_type_unavailable' });

    expect(await accountId(orgId)).toBeUndefined();
    expect(await raw.memberships(orgId)).toHaveLength(0);
    expect(await raw.count('workspace_entitlements', orgId)).toBe(0);
  });

  it('a second org via the same path sees only its own entitlements', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    orgIds.push(orgA, orgB);

    expect(
      (await createOrgCore(ctxFor(orgA, randomUUID(), 'owner'), {
        nameEn: 'Isolation A',
        firmType: 'interior',
      })).ok,
    ).toBe(true);
    expect(
      (await createOrgCore(ctxFor(orgB, randomUUID(), 'owner'), {
        nameEn: 'Isolation B',
        firmType: 'interior',
      })).ok,
    ).toBe(true);

    expect(await raw.count('workspace_entitlements', orgA)).toBe(1);
    expect(await raw.count('workspace_entitlements', orgB)).toBe(1);
    expect(await enabledFlows(orgA)).toEqual(['interior']);
    expect(await enabledFlows(orgB)).toEqual(['interior']);
  });
});
