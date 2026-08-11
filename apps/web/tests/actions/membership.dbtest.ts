import { afterAll, describe, expect, it } from 'vitest';
import { ensureNotLastOwner } from '@/lib/aggregates/membership';
import { withOrgContext } from '@/lib/db/context';
import { changeMemberRoleCore, removeMemberCore } from '@/lib/team/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];

afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('last-owner invariant (ensureNotLastOwner)', () => {
  it('rejects when the org has a single owner', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await expect(
      withOrgContext(ctx, (tx) => ensureNotLastOwner(tx)),
    ).rejects.toThrow();
  });

  it('passes when the org has two owners', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 2 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await expect(
      withOrgContext(ctx, (tx) => ensureNotLastOwner(tx)),
    ).resolves.toBeUndefined();
  });
});

describe('removeMemberCore', () => {
  it('lets an owner remove a viewer', async () => {
    const { orgId, ownerIds, memberIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'viewer' }],
    });
    orgIds.push(orgId);
    const res = await removeMemberCore(
      ctxFor(orgId, ownerIds[0], 'owner'),
      memberIds[0],
    );
    expect(res.ok).toBe(true);
  });

  it('refuses to remove yourself', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 2 });
    orgIds.push(orgId);
    const res = await removeMemberCore(
      ctxFor(orgId, ownerIds[0], 'owner'),
      ownerIds[0],
    );
    expect(res).toEqual({ ok: false, error: 'self' });
  });
});

describe('mutateInOrg capability gate', () => {
  it('refuses a viewer and writes nothing (removeMemberCore + changeMemberRoleCore)', async () => {
    const { orgId, ownerIds, memberIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'viewer' }],
    });
    orgIds.push(orgId);
    const viewerCtx = ctxFor(orgId, memberIds[0], 'viewer');

    const membersBefore = await raw.count('memberships', orgId);
    const auditBefore = await raw.count('audit_log', orgId);

    // A viewer cannot remove a member...
    const remove = await removeMemberCore(viewerCtx, ownerIds[0]);
    expect(remove).toEqual({ ok: false, error: 'forbidden' });

    // ...nor change a role. The gate fires before withOrgContext opens, so no row moves.
    const change = await changeMemberRoleCore(viewerCtx, {
      userId: ownerIds[0],
      role: 'admin',
    });
    expect(change).toEqual({ ok: false, error: 'forbidden' });

    expect(await raw.count('memberships', orgId)).toBe(membersBefore);
    expect(await raw.count('audit_log', orgId)).toBe(auditBefore);
  });
});
