import { afterAll, describe, expect, it } from 'vitest';
import { changeMemberRoleCore, removeMemberCore } from '@/lib/team/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Security batch 3, A5: the one ordinary race in which the membership
// role-writer trigger (MT150) refuses a write the app's gate let through. The
// request was opened while the caller was an owner; he was demoted before its
// transaction wrote. The cores answer `forbidden`, not a logged `generic`
// (lib/team/core/membership-write.ts). The trigger's own rules are
// membership-role-writer.dbtest.ts.

const orgIds: string[] = [];

afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

type Studio = Record<'orgId' | 'owner' | 'secondOwner' | 'demoted' | 'manager', string>;

/** Three owners and a project manager; `demoted` is the owner whose request is in flight. */
async function seedStudio(): Promise<Studio> {
  const seeded = await seedOrg({ owners: 3, members: [{ role: 'project_manager' }] });
  const { orgId, ownerIds: [owner, secondOwner, demoted], memberIds: [manager] } = seeded;
  orgIds.push(orgId);
  return { orgId, owner, secondOwner, demoted, manager };
}

/** Another owner's change, already committed: `demoted` now holds `role`. */
async function demoteTo(studio: Studio, role: 'viewer' | 'admin'): Promise<void> {
  await raw.query(`update public.memberships set role = '${role}' where org_id = '${studio.orgId}' and user_id = '${studio.demoted}'`);
}

async function rolesOf(studio: Studio): Promise<Record<string, string>> {
  return Object.fromEntries((await raw.memberships(studio.orgId)).map((row) => [row.user_id, row.role]));
}

describe('a caller demoted while his request was in flight', () => {
  it('now a viewer: changing a role or removing a member is forbidden, and nothing changes', async () => {
    const studio = await seedStudio();
    await demoteTo(studio, 'viewer');
    const stale = ctxFor(studio.orgId, studio.demoted, 'owner');
    const before = await rolesOf(studio);

    expect(await changeMemberRoleCore(stale, { userId: studio.manager, role: 'admin' })).toEqual({ ok: false, error: 'forbidden' });
    expect(await removeMemberCore(stale, studio.manager)).toEqual({ ok: false, error: 'forbidden' });
    expect(await rolesOf(studio)).toEqual(before);
  });

  it('now an admin: an owner is out of his reach, a project manager is not', async () => {
    const studio = await seedStudio();
    await demoteTo(studio, 'admin');
    const stale = ctxFor(studio.orgId, studio.demoted, 'owner');

    expect(await changeMemberRoleCore(stale, { userId: studio.secondOwner, role: 'admin' })).toEqual({ ok: false, error: 'forbidden' });
    expect(await removeMemberCore(stale, studio.secondOwner)).toEqual({ ok: false, error: 'forbidden' });
    expect(await changeMemberRoleCore(stale, { userId: studio.manager, role: 'viewer' })).toMatchObject({ ok: true });
    expect(await rolesOf(studio)).toMatchObject({ [studio.owner]: 'owner', [studio.secondOwner]: 'owner', [studio.demoted]: 'admin', [studio.manager]: 'viewer' });
  });
});
