import { randomUUID } from 'node:crypto';
import { createSql, type MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { assignSiteMemberCore, unassignSiteMemberCore } from '@/lib/site/assignments/core';
import { listProjectSiteTeam } from '@/lib/site/assignments/queries';
import { appQuery, closeExecutionFixture, ownerQuery, seedClientProject, sqlstate } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';
import { seedMember } from './site-fixture';

// PR S3: a project's site team through its cores (plan C3, AC6). Who may
// assign and take off (owner, admin, project manager), whom (a member of the
// studio with an internal role, checked by the core because the table has no
// foreign key to people), one live row per member and project, the audit rows,
// and, for every role the core refuses, the same write by direct SQL refused
// by the database (rls/policies/70-site.sql), so the core is not the only fence.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let projectId: string;
let otherOrgId: string;
let otherOrgProjectId: string;
let otherOrgMemberId: string;

const ROLES: readonly MemberRole[] = ['owner', 'admin', 'project_manager', 'site_engineer', 'accountant', 'viewer', 'client'];
const MANAGERS: readonly MemberRole[] = ['owner', 'admin', 'project_manager'];
/** One member of each role, besides the seeded owner. */
const memberOf = {} as Record<MemberRole, string>;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  const other = await seedOrg({ owners: 1 });
  otherOrgId = other.orgId;
  otherOrgMemberId = await seedMember(otherOrgId, 'site_engineer');
  orgIds.push(orgId, otherOrgId);
  ({ projectId } = await seedClientProject(orgId));
  ({ projectId: otherOrgProjectId } = await seedClientProject(otherOrgId));
  for (const role of ROLES) memberOf[role] = await seedMember(orgId, role);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const ctxOf = (role: MemberRole) => ctxFor(orgId, memberOf[role], role);
const ownerCtx = () => ctxFor(orgId, ownerId, 'owner');

/** A project of this studio with nobody on its site yet. */
async function freshProject(): Promise<string> {
  return (await seedClientProject(orgId)).projectId;
}

async function assignmentsOf(project: string, userId: string) {
  return ownerQuery<{ id: string; assigned_by: string; revoked_at: Date | null; revoked_by: string | null }>(
    `select id, assigned_by, revoked_at, revoked_by from public.project_assignments
      where org_id = $1 and project_id = $2 and user_id = $3 order by created_at`,
    [orgId, project, userId],
  );
}

async function auditOf(entityId: string) {
  return ownerQuery<{ action: string; actor_user_id: string; before: unknown; after: unknown }>(
    `select action, actor_user_id, before, after from public.audit_log
      where org_id = $1 and entity = 'project_assignment' and entity_id = $2 order by created_at`,
    [orgId, entityId],
  );
}

describe('the role matrix: owner, admin and project manager change a site team, nobody else', () => {
  it.each(MANAGERS)('%s assigns and takes off, stamped with himself', async (role) => {
    const project = await freshProject();
    const engineer = await seedMember(orgId, 'site_engineer');
    expect(await assignSiteMemberCore(ctxOf(role), { projectId: project, userId: engineer })).toEqual({ ok: true });
    expect((await assignmentsOf(project, engineer))[0]).toMatchObject({ assigned_by: memberOf[role], revoked_at: null });
    expect(await unassignSiteMemberCore(ctxOf(role), { projectId: project, userId: engineer })).toMatchObject({ ok: true });
    expect((await assignmentsOf(project, engineer))[0]).toMatchObject({ revoked_by: memberOf[role] });
  });

  it.each(ROLES.filter((role) => !MANAGERS.includes(role)))('%s is forbidden by the core, and refused by the database too', async (role) => {
    const project = await freshProject();
    const engineer = await seedMember(orgId, 'site_engineer');
    expect(await assignSiteMemberCore(ctxOf(role), { projectId: project, userId: engineer })).toEqual({ ok: false, error: 'forbidden' });
    expect(await assignmentsOf(project, engineer)).toEqual([]);
    expect(
      await sqlstate(
        appQuery(orgId, memberOf[role], `insert into public.project_assignments (org_id, project_id, user_id, assigned_by) values ($1, $2, $3, $4)`, [
          orgId,
          project,
          engineer,
          memberOf[role],
        ]),
      ),
    ).toBe('42501');

    await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer });
    expect(await unassignSiteMemberCore(ctxOf(role), { projectId: project, userId: engineer })).toEqual({ ok: false, error: 'forbidden' });
    const revokedBySql = await appQuery(
      orgId,
      memberOf[role],
      `update public.project_assignments set revoked_at = now(), revoked_by = $3 where project_id = $1 and user_id = $2 returning id`,
      [project, engineer, memberOf[role]],
    );
    expect(revokedBySql).toEqual([]);
    expect((await assignmentsOf(project, engineer))[0].revoked_at).toBeNull();
  });
});

describe('assignSiteMemberCore', () => {
  it('assigns every internal role (a PM who wants the app assigns himself)', async () => {
    const project = await freshProject();
    for (const role of ROLES.filter((r) => r !== 'client')) {
      expect(await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: memberOf[role] }), role).toEqual({ ok: true });
    }
    expect(await assignSiteMemberCore(ctxOf('project_manager'), { projectId: project, userId: ownerId })).toEqual({ ok: true });
  });

  it('assigning the same member twice keeps one live row and answers already (AC6), with one audit row', async () => {
    const project = await freshProject();
    const engineer = await seedMember(orgId, 'site_engineer');
    expect(await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer })).toEqual({ ok: true });
    expect(await assignSiteMemberCore(ctxOf('admin'), { projectId: project, userId: engineer })).toEqual({ ok: true, already: true });
    const rows = await assignmentsOf(project, engineer);
    expect(rows).toHaveLength(1);
    expect(rows[0].assigned_by).toBe(ownerId);
    const audit = await auditOf(rows[0].id);
    expect(audit).toEqual([
      { action: 'create', actor_user_id: ownerId, before: null, after: { project_id: project, user_id: engineer, role: 'site_engineer' } },
    ]);
  });

  it('ten racing assigns make one live row: one assigned, nine already', async () => {
    const project = await freshProject();
    const engineer = await seedMember(orgId, 'site_engineer');
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer })),
    );
    expect(answers.filter((answer) => answer.ok && !answer.already)).toHaveLength(1);
    expect(answers.filter((answer) => answer.ok && answer.already)).toHaveLength(9);
    expect(await assignmentsOf(project, engineer)).toHaveLength(1);
  });

  it('waits for a member removal in flight (the same per-org lock): removed meanwhile is not_member, no live row left', async () => {
    const remover = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
    const project = await freshProject();
    const engineer = await seedMember(orgId, 'site_engineer');
    let assigning: Promise<ActionResult> | undefined;
    await remover.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${orgId}))`;
      assigning = assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx`delete from public.memberships where org_id = ${orgId} and user_id = ${engineer}`;
    });
    await remover.end();
    expect(await assigning).toEqual({ ok: false, error: 'not_member' });
    expect(await assignmentsOf(project, engineer)).toEqual([]);
  });

  it('refuses whoever is not an internal member of this studio as not_member, and writes nothing (AC6)', async () => {
    const project = await freshProject();
    const strangers: Array<[string, string]> = [
      ['a uuid that is nobody', randomUUID()],
      ["another studio's engineer", otherOrgMemberId],
      ['a member with the client role', memberOf.client],
    ];
    for (const [label, userId] of strangers) {
      expect(await assignSiteMemberCore(ownerCtx(), { projectId: project, userId }), label).toEqual({ ok: false, error: 'not_member' });
      expect(await assignmentsOf(project, userId), label).toEqual([]);
    }
  });

  it("refuses a project that is not this studio's as project_not_found", async () => {
    const engineer = memberOf.site_engineer;
    expect(await assignSiteMemberCore(ownerCtx(), { projectId: randomUUID(), userId: engineer })).toEqual({ ok: false, error: 'project_not_found' });
    expect(await assignSiteMemberCore(ownerCtx(), { projectId: otherOrgProjectId, userId: engineer })).toEqual({
      ok: false,
      error: 'project_not_found',
    });
  });

  it('refuses ids that are not uuids as malformed before touching the database', async () => {
    expect(await assignSiteMemberCore(ownerCtx(), { projectId: 'p-1', userId: memberOf.site_engineer })).toEqual({ ok: false, error: 'malformed' });
    expect(await assignSiteMemberCore(ownerCtx(), { projectId, userId: "' or 1=1 --" })).toEqual({ ok: false, error: 'malformed' });
    expect(await assignSiteMemberCore(ownerCtx(), null as never), 'no input at all (a direct action call)').toEqual({ ok: false, error: 'malformed' });
  });
});

describe('unassignSiteMemberCore', () => {
  it('stamps the live row revoked by the current user, audits it, and a later assign is a new row', async () => {
    const project = await freshProject();
    const engineer = await seedMember(orgId, 'site_engineer');
    await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer });
    expect(await unassignSiteMemberCore(ctxOf('project_manager'), { projectId: project, userId: engineer })).toMatchObject({ ok: true });
    const [first] = await assignmentsOf(project, engineer);
    expect(first.revoked_by).toBe(memberOf.project_manager);
    expect(first.revoked_at).not.toBeNull();
    expect((await auditOf(first.id)).map((row) => [row.action, row.actor_user_id, row.after])).toEqual([
      ['create', ownerId, { project_id: project, user_id: engineer, role: 'site_engineer' }],
      ['update', memberOf.project_manager, { revoked: true, project_id: project, user_id: engineer }],
    ]);

    expect(await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer })).toEqual({ ok: true });
    const rows = await assignmentsOf(project, engineer);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.revoked_at === null)).toEqual([false, true]);
  });

  it('answers entry_not_found when there is no live assignment, and changes nothing', async () => {
    const project = await freshProject();
    const engineer = await seedMember(orgId, 'site_engineer');
    expect(await unassignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer })).toEqual({ ok: false, error: 'entry_not_found' });
    await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer });
    await unassignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer });
    const [revoked] = await assignmentsOf(project, engineer);
    expect(await unassignSiteMemberCore(ctxOf('admin'), { projectId: project, userId: engineer })).toEqual({ ok: false, error: 'entry_not_found' });
    expect((await assignmentsOf(project, engineer))[0]).toEqual(revoked);
    expect(await unassignSiteMemberCore(ownerCtx(), { projectId: otherOrgProjectId, userId: otherOrgMemberId })).toEqual({
      ok: false,
      error: 'entry_not_found',
    });
  });

  it('refuses ids that are not uuids as malformed', async () => {
    expect(await unassignSiteMemberCore(ownerCtx(), { projectId, userId: 'nobody' })).toEqual({ ok: false, error: 'malformed' });
    expect(await unassignSiteMemberCore(ownerCtx(), 'p-1' as never)).toEqual({ ok: false, error: 'malformed' });
  });
});

describe('what the database still refuses after a core assigned (S2 rules the cores lean on)', () => {
  it('keeps the identity columns of an assignment and its revoke final, even for the owner (MT100)', async () => {
    const project = await freshProject();
    const engineer = await seedMember(orgId, 'site_engineer');
    await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer });
    const [row] = await assignmentsOf(project, engineer);
    const asOwner = (text: string, params: unknown[]) => appQuery(orgId, ownerId, text, params);
    expect(await sqlstate(asOwner(`update public.project_assignments set user_id = $2 where id = $1`, [row.id, memberOf.viewer]))).toBe('MT100');
    expect(await sqlstate(asOwner(`update public.project_assignments set assigned_by = $2 where id = $1`, [row.id, memberOf.admin]))).toBe('MT100');
    expect(await sqlstate(asOwner(`update public.project_assignments set revoked_at = now(), revoked_by = $2 where id = $1`, [row.id, memberOf.admin]))).toBe(
      'MT100',
    );
    await unassignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer });
    expect(await sqlstate(asOwner(`update public.project_assignments set revoked_at = null, revoked_by = null where id = $1`, [row.id]))).toBe('MT100');
  });

  it("refuses a manager's direct insert in someone else's name (42501)", async () => {
    const project = await freshProject();
    expect(
      await sqlstate(
        appQuery(orgId, memberOf.project_manager, `insert into public.project_assignments (org_id, project_id, user_id, assigned_by) values ($1, $2, $3, $4)`, [
          orgId,
          project,
          memberOf.site_engineer,
          ownerId,
        ]),
      ),
    ).toBe('42501');
  });
});

describe('listProjectSiteTeam', () => {
  it('lists only the members with a live assignment on this project, longest on it first, and never a client', async () => {
    const project = await freshProject();
    const elsewhere = await freshProject();
    await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: memberOf.site_engineer });
    await assignSiteMemberCore(ownerCtx(), { projectId: elsewhere, userId: memberOf.viewer });
    await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: memberOf.accountant });
    await unassignSiteMemberCore(ownerCtx(), { projectId: project, userId: memberOf.accountant });
    await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: memberOf.project_manager });

    const team = await listProjectSiteTeam(ctxOf('viewer'), project, 30);
    expect(team.members.map((member) => member.userId)).toEqual([memberOf.site_engineer, memberOf.project_manager]);
    expect(team.members[0]).toMatchObject({ role: 'site_engineer', assignedAt: expect.any(Date) });
    expect(team.total).toBe(2);
  });

  it('renders at most `limit` of a long team and counts the whole of it', async () => {
    const project = await freshProject();
    for (let index = 0; index < 5; index += 1) {
      await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: await seedMember(orgId, 'site_engineer') });
    }
    const team = await listProjectSiteTeam(ownerCtx(), project, 3);
    expect(team.members).toHaveLength(3);
    expect(team.total).toBe(5);
    expect(await listProjectSiteTeam(ownerCtx(), await freshProject(), 3)).toEqual({ members: [], total: 0 });
  });

  it("shows another studio's project as an empty team", async () => {
    expect(await listProjectSiteTeam(ownerCtx(), otherOrgProjectId, 30)).toEqual({ members: [], total: 0 });
  });
});

describe('the security test repros (S3 round), kept', () => {
  it.each<MemberRole>(['site_engineer', 'viewer', 'accountant', 'client'])(
    'a %s carrying a forged owner role in its context cannot assign or take off: the database refuses',
    async (real) => {
      const project = await freshProject();
      const engineer = await seedMember(orgId, 'site_engineer');
      const forged = ctxFor(orgId, memberOf[real], 'owner');
      expect((await assignSiteMemberCore(forged, { projectId: project, userId: engineer })).ok).toBe(false);
      expect(await assignmentsOf(project, engineer)).toEqual([]);
      await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer });
      expect((await unassignSiteMemberCore(forged, { projectId: project, userId: engineer })).ok).toBe(false);
      expect((await assignmentsOf(project, engineer))[0].revoked_at).toBeNull();
    },
  );

  it('a project manager removed mid-session (his context still says PM) cannot assign', async () => {
    const pm = await seedMember(orgId, 'project_manager');
    const engineer = await seedMember(orgId, 'site_engineer');
    const project = await freshProject();
    await ownerQuery(`delete from public.memberships where org_id = $1 and user_id = $2`, [orgId, pm]);
    expect((await assignSiteMemberCore(ctxFor(orgId, pm, 'project_manager'), { projectId: project, userId: engineer })).ok).toBe(false);
    expect(await assignmentsOf(project, engineer)).toEqual([]);
  });

  it('a member who is an engineer here and a client in another studio is assigned, audited with his role here', async () => {
    const engineer = await seedMember(orgId, 'site_engineer');
    await ownerQuery(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'client')`, [otherOrgId, engineer]);
    const project = await freshProject();
    expect(await assignSiteMemberCore(ownerCtx(), { projectId: project, userId: engineer })).toEqual({ ok: true });
    const [row] = await assignmentsOf(project, engineer);
    expect((await auditOf(row.id))[0].after).toEqual({ project_id: project, user_id: engineer, role: 'site_engineer' });
  });

  it("another studio's engineer on another studio's project is project_not_found (the project is checked first), and nothing is written", async () => {
    expect(await assignSiteMemberCore(ownerCtx(), { projectId: otherOrgProjectId, userId: otherOrgMemberId })).toEqual({
      ok: false,
      error: 'project_not_found',
    });
    const rows = await ownerQuery(`select id from public.project_assignments where user_id = $1`, [otherOrgMemberId]);
    expect(rows).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['an array for the member', { projectId: randomUUID(), userId: ['x'] }],
    ['an object that prints as a uuid', { projectId: { toString: () => randomUUID() }, userId: randomUUID() }],
    ['a quote-or-1=1 project id', { projectId: "' or 1=1 --", userId: randomUUID() }],
  ])('%s is malformed for both cores', async (_label, input) => {
    expect(await assignSiteMemberCore(ownerCtx(), input as never)).toEqual({ ok: false, error: 'malformed' });
    expect(await unassignSiteMemberCore(ownerCtx(), input as never)).toEqual({ ok: false, error: 'malformed' });
  });
});
