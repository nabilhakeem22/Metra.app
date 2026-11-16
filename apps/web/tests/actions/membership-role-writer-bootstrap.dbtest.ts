import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createOrgCore } from '@/lib/org/core';
import { acceptInviteCore } from '@/lib/team/core';
import { appQuery, closeExecutionFixture, ownerQuery, sqlstate } from './execution-fixture';
import { closeFixture, ctxFor, raw, seedOrg, seedPendingInvite, teardown } from './fixture';

// Security batch 3, A5: the two BOOTSTRAP inserts trg_memberships_role_writer
// admits from someone who is not a member yet, and nothing wider. A founder
// takes `owner` in a studio with no member; a joiner takes exactly the role of
// the invitation claimed IN THE SAME TRANSACTION. Before this the policy's
// carve-out let either of them write any role, and an invitation accepted long
// ago kept authorising inserts. The member-to-member rules are
// membership-role-writer.dbtest.ts.

const orgIds: string[] = [];

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/**
 * Statements run as metra_app in ONE transaction, as a user who is in the org
 * context but may not be a member: the SQLSTATE that refused them, or null.
 */
function runAs(orgId: string, userId: string, email: string, statements: string[]): Promise<string | null> {
  return sqlstate(appQuery(orgId, userId, [`select set_config('app.current_user_email', '${email}', true)`, ...statements].join(';\n')));
}

const ownMembership = (orgId: string, userId: string, role: string) =>
  `insert into public.memberships (id, org_id, user_id, role) values (gen_random_uuid(), '${orgId}', '${userId}', '${role}')`;
const claim = (invitationId: string) => `select id from public.app_claim_invitation('${invitationId}')`;

async function invitationStatus(invitationId: string): Promise<string> {
  const [row] = await ownerQuery<{ status: string }>(`select status from public.invitations where id = $1`, [invitationId]);
  return row.status;
}

/** A studio with one owner and a pending invitation for a new person. */
async function studioWithInvite(role: 'viewer' | 'admin' | 'owner' = 'viewer') {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const email = `joiner-${randomUUID()}@example.com`;
  const invitationId = await seedPendingInvite(orgId, email, ownerIds[0], role);
  return { orgId, email, invitationId, joiner: randomUUID() };
}

describe('founding a studio (AC25)', () => {
  it('createOrgCore still creates the studio and its owner', async () => {
    const orgId = randomUUID();
    const founder = randomUUID();
    orgIds.push(orgId);
    expect(await createOrgCore(ctxFor(orgId, founder, 'owner'), { nameEn: 'Role writer founding', city: 'Cairo' })).toMatchObject({ ok: true });
    expect(await raw.memberships(orgId)).toEqual([{ user_id: founder, role: 'owner' }]);
  });

  it.each(['admin', 'viewer'])('a first membership inserted as %s into an empty studio is MT150, and the studio is not created', async (role) => {
    const orgId = randomUUID();
    const founder = randomUUID();
    const studio = `insert into public.organizations (id, name_en) values ('${orgId}', 'Role writer refused')`;
    expect(await runAs(orgId, founder, '', [studio, ownMembership(orgId, founder, role)])).toBe('MT150');
    expect(await ownerQuery(`select id from public.organizations where id = $1`, [orgId])).toEqual([]);
  });

  it('a founder cannot make someone else the first member', async () => {
    const orgId = randomUUID();
    const studio = `insert into public.organizations (id, name_en) values ('${orgId}', 'Role writer refused')`;
    expect(await runAs(orgId, randomUUID(), '', [studio, ownMembership(orgId, randomUUID(), 'owner')])).toBe('MT150');
  });
});

describe('joining by invitation (AC26)', () => {
  it('acceptInviteCore on a viewer invitation creates a viewer membership', async () => {
    const { orgId, email, invitationId, joiner } = await studioWithInvite();
    expect(await acceptInviteCore(ctxFor(orgId, joiner, 'viewer', email), invitationId)).toEqual({ ok: true });
    expect((await raw.memberships(orgId)).find((row) => row.user_id === joiner)).toEqual({ user_id: joiner, role: 'viewer' });
  });

  it('the same claim and insert in raw SQL pass, with the role of the invitation', async () => {
    const { orgId, email, invitationId, joiner } = await studioWithInvite('admin');
    expect(await runAs(orgId, joiner, email, [claim(invitationId), ownMembership(orgId, joiner, 'admin')])).toBeNull();
    expect(await invitationStatus(invitationId)).toBe('accepted');
  });

  it.each(['admin', 'owner', 'project_manager'])('claiming a viewer invitation and inserting %s is MT150, and the claim rolls back', async (role) => {
    const { orgId, email, invitationId, joiner } = await studioWithInvite();
    expect(await runAs(orgId, joiner, email, [claim(invitationId), ownMembership(orgId, joiner, role)])).toBe('MT150');
    expect(await invitationStatus(invitationId)).toBe('pending');
    expect((await raw.memberships(orgId)).some((row) => row.user_id === joiner)).toBe(false);
  });

  // The invitations policy does not hold the role an invitation names, so any
  // member could write a row that says owner. The trigger does not believe it.
  it('an invitation that says owner admits nobody as owner, and the claim rolls back', async () => {
    const { orgId, email, invitationId, joiner } = await studioWithInvite('owner');
    expect(await runAs(orgId, joiner, email, [claim(invitationId), ownMembership(orgId, joiner, 'owner')])).toBe('MT150');
    expect(await invitationStatus(invitationId)).toBe('pending');
    expect((await raw.memberships(orgId)).some((row) => row.user_id === joiner)).toBe(false);
  });

  it('acceptInviteCore with a role that is not the invitation is refused, and the invitation stays claimable', async () => {
    const { orgId, email, invitationId, joiner } = await studioWithInvite();
    await expect(acceptInviteCore(ctxFor(orgId, joiner, 'admin', email), invitationId)).rejects.toThrow();
    expect(await invitationStatus(invitationId)).toBe('pending');
    expect(await acceptInviteCore(ctxFor(orgId, joiner, 'viewer', email), invitationId)).toEqual({ ok: true });
  });

  it('an invitation claimed in an EARLIER transaction does not authorise a later insert', async () => {
    const { orgId, email, invitationId, joiner } = await studioWithInvite();
    expect(await runAs(orgId, joiner, email, [claim(invitationId)])).toBeNull();
    expect(await invitationStatus(invitationId)).toBe('accepted');
    expect(await runAs(orgId, joiner, email, [ownMembership(orgId, joiner, 'viewer')])).toBe('MT150');
    expect(await runAs(orgId, joiner, email, [ownMembership(orgId, joiner, 'admin')])).toBe('MT150');
    expect((await raw.memberships(orgId)).some((row) => row.user_id === joiner)).toBe(false);
  });

  it('a claim does not let the joiner add somebody else, and nobody joins without one', async () => {
    const { orgId, email, invitationId, joiner } = await studioWithInvite();
    expect(await runAs(orgId, joiner, email, [claim(invitationId), ownMembership(orgId, randomUUID(), 'viewer')])).toBe('MT150');
    expect(await runAs(orgId, randomUUID(), 'stranger@example.com', [ownMembership(orgId, randomUUID(), 'viewer')])).toBe('MT150');
    const stranger = randomUUID();
    expect(await runAs(orgId, stranger, 'stranger@example.com', [ownMembership(orgId, stranger, 'viewer')])).toBe('MT150');
    expect(await invitationStatus(invitationId)).toBe('pending');
  });
});
