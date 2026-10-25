import { randomUUID } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appQuery, closeExecutionFixture, ownerQuery, seedClientProject, sqlstate } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';
import {
  appInsert,
  materialRow,
  noteRow,
  ownerInsert,
  photoRow,
  seedAssignment,
  seedMember,
  visitRow,
} from './site-fixture';

// Site diary DB step S: who may do what to the seven site tables, at the
// database. The grants (SELECT, INSERT, UPDATE, never DELETE); the RESTRICTIVE
// policies (AC5: a site engineer writes only on a project with his live
// assignment, and accountants and viewers write nothing; the S2 security
// round's fences are site-writers.dbtest.ts); org isolation with REAL rows
// (AC25; the isolation gate's seed has none in these tables); and the
// session-scoped org list behind a device revoke (AC37's database half).

const SITE_TABLES = [
  'project_assignments',
  'site_devices',
  'site_location_consents',
  'site_material_receipts',
  'site_notes',
  'site_photos',
  'site_visits',
];

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let otherOrgId: string;
let otherOwnerId: string;
let projectId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  const other = await seedOrg({ owners: 1 });
  otherOrgId = other.orgId;
  otherOwnerId = other.ownerIds[0];
  orgIds.push(orgId, otherOrgId);
  ({ projectId } = await seedClientProject(orgId));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

describe('grants: exactly what roles.sql leaves metra_app with', () => {
  it('is SELECT, INSERT and UPDATE on all seven tables, and never DELETE', async () => {
    const rows = await ownerQuery<{ table_name: string; privileges: string }>(
      `select t as table_name,
              concat_ws(',',
                case when has_table_privilege('metra_app', 'public.' || t, 'select') then 'S' end,
                case when has_table_privilege('metra_app', 'public.' || t, 'insert') then 'I' end,
                case when has_table_privilege('metra_app', 'public.' || t, 'update') then 'U' end,
                case when has_table_privilege('metra_app', 'public.' || t, 'delete') then 'D' end,
                case when has_table_privilege('metra_app', 'public.' || t, 'truncate') then 'T' end) as privileges
         from unnest($1::text[]) as t order by 1`,
      [SITE_TABLES],
    );
    expect(Object.fromEntries(rows.map((row) => [row.table_name, row.privileges]))).toEqual(
      Object.fromEntries(SITE_TABLES.map((table) => [table, 'S,I,U'])),
    );
  });

  it('answers a metra_app DELETE on every one of them with 42501', async () => {
    for (const table of SITE_TABLES) {
      expect(await sqlstate(appQuery(orgId, ownerId, `delete from public.${table}`)), table).toBe('42501');
    }
  });

  it('lets metra_app, and nobody else, execute the two gates, the own-row rule, the session org list and the photo key', async () => {
    const rows = await ownerQuery<{ proname: string; app: boolean; public_execute: boolean; secdef: boolean }>(
      `select p.proname, has_function_privilege('metra_app', p.oid, 'execute') as app,
              exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
              p.prosecdef as secdef
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('app_may_write_site_project', 'app_may_manage_site_project', 'app_is_self_or_site_manager', 'app_current_user_orgs_for_session', 'site_photo_object_key')
        order by 1`,
    );
    expect(rows).toEqual([
      { proname: 'app_current_user_orgs_for_session', app: true, public_execute: false, secdef: true },
      { proname: 'app_is_self_or_site_manager', app: true, public_execute: false, secdef: false },
      { proname: 'app_may_manage_site_project', app: true, public_execute: false, secdef: true },
      { proname: 'app_may_write_site_project', app: true, public_execute: false, secdef: true },
      { proname: 'site_photo_object_key', app: true, public_execute: false, secdef: false },
    ]);
  });
});

describe('the restrictive insert policy site_write_assigned (AC5)', () => {
  it('declares exactly the fifteen RESTRICTIVE site policies, each for one command', async () => {
    const rows = await ownerQuery<{ policy: string; cmd: string }>(
      `select tablename || '.' || policyname as policy, cmd from pg_policies
        where schemaname = 'public' and permissive = 'RESTRICTIVE' and tablename = any($1::text[]) order by 1`,
      [SITE_TABLES],
    );
    const diary = ['site_material_receipts', 'site_notes', 'site_photos', 'site_visits'];
    expect(rows).toEqual(
      [
        { policy: 'project_assignments.site_managers_insert', cmd: 'INSERT' },
        { policy: 'project_assignments.site_managers_update', cmd: 'UPDATE' },
        { policy: 'site_devices.site_device_self_insert', cmd: 'INSERT' },
        { policy: 'site_devices.site_device_self_or_manager_select', cmd: 'SELECT' },
        { policy: 'site_devices.site_device_self_or_manager_update', cmd: 'UPDATE' },
        { policy: 'site_location_consents.site_consent_self_insert', cmd: 'INSERT' },
        { policy: 'site_location_consents.site_consent_self_update', cmd: 'UPDATE' },
        ...diary.flatMap((table) => [
          { policy: `${table}.site_update_assigned`, cmd: 'UPDATE' },
          { policy: `${table}.site_write_assigned`, cmd: 'INSERT' },
        ]),
      ].sort((a, b) => (a.policy < b.policy ? -1 : 1)),
    );
  });

  async function canCheckIn(userId: string): Promise<string | null> {
    return sqlstate(appInsert(orgId, userId, 'site_visits', visitRow(orgId, projectId, userId)));
  }

  it('refuses an unassigned site engineer (42501), admits him once assigned, and refuses him again after the revoke', async () => {
    const engineerId = await seedMember(orgId, 'site_engineer');
    expect(await canCheckIn(engineerId)).toBe('42501');
    const assignmentId = await seedAssignment(orgId, projectId, engineerId, ownerId);
    expect(await canCheckIn(engineerId)).toBeNull();
    await ownerQuery(`update public.project_assignments set revoked_at = now(), revoked_by = $2 where id = $1`, [
      assignmentId,
      ownerId,
    ]);
    expect(await canCheckIn(engineerId)).toBe('42501');
  });

  it('admits owner, admin and project manager on any project of the studio, and refuses accountant and viewer', async () => {
    const answers: Record<string, string | null> = {};
    for (const role of ['admin', 'project_manager', 'accountant', 'viewer'] as MemberRole[]) {
      answers[role] = await canCheckIn(await seedMember(orgId, role));
    }
    answers.owner = await canCheckIn(ownerId);
    expect(answers).toEqual({ owner: null, admin: null, project_manager: null, accountant: '42501', viewer: '42501' });
  });

  it("refuses an engineer's photo, delivery and note on a project he is not assigned to, even on a visit that exists", async () => {
    const engineerId = await seedMember(orgId, 'site_engineer');
    const visitId = await ownerInsert('site_visits', visitRow(orgId, projectId, ownerId));
    for (const [table, row] of [
      ['site_photos', photoRow(orgId, projectId, visitId, engineerId)],
      ['site_material_receipts', materialRow(orgId, projectId, visitId, engineerId)],
      ['site_notes', noteRow(orgId, projectId, visitId, engineerId)],
    ] as const) {
      expect(await sqlstate(appInsert(orgId, engineerId, table, row)), table).toBe('42501');
    }
  });

  it('assigned on one project, he still writes nothing on another', async () => {
    const engineerId = await seedMember(orgId, 'site_engineer');
    const other = await seedClientProject(orgId);
    await seedAssignment(orgId, other.projectId, engineerId, ownerId);
    expect(await canCheckIn(engineerId)).toBe('42501');
    expect(await sqlstate(appInsert(orgId, engineerId, 'site_visits', visitRow(orgId, other.projectId, engineerId)))).toBeNull();
  });

  it('answers the gate directly: true only for the caller in the current org', async () => {
    const engineerId = await seedMember(orgId, 'site_engineer');
    await seedAssignment(orgId, projectId, engineerId, ownerId);
    const ask = async (askingOrg: string, userId: string) => {
      const [row] = await appQuery<{ may: boolean }>(askingOrg, userId, `select public.app_may_write_site_project($1) as may`, [projectId]);
      return row.may;
    };
    expect(await ask(orgId, engineerId)).toBe(true);
    expect(await ask(otherOrgId, engineerId)).toBe(false);
    expect(await ask(orgId, randomUUID())).toBe(false);
  });
});

describe('org isolation with real rows in all seven tables (AC25)', () => {
  beforeAll(async () => {
    const theirs = await seedClientProject(otherOrgId);
    await seedAssignment(otherOrgId, theirs.projectId, otherOwnerId, otherOwnerId);
    await ownerInsert('site_location_consents', { org_id: otherOrgId, user_id: otherOwnerId, policy_version: 1 });
    await ownerInsert('site_devices', { org_id: otherOrgId, user_id: otherOwnerId, auth_session_id: randomUUID(), label: 'iPhone' });
    const visitId = await ownerInsert('site_visits', visitRow(otherOrgId, theirs.projectId, otherOwnerId));
    await ownerInsert('site_photos', photoRow(otherOrgId, theirs.projectId, visitId, otherOwnerId));
    await ownerInsert('site_material_receipts', materialRow(otherOrgId, theirs.projectId, visitId, otherOwnerId));
    await ownerInsert('site_notes', noteRow(otherOrgId, theirs.projectId, visitId, otherOwnerId));
  });

  it("its own member sees the rows; org A's member sees none of them", async () => {
    for (const table of SITE_TABLES) {
      const [own] = await appQuery<{ n: number }>(otherOrgId, otherOwnerId, `select count(*)::int as n from public.${table} where org_id = $1`, [otherOrgId]);
      expect(own.n, `${table}: the owning org reads its row`).toBeGreaterThan(0);
      const [leaked] = await appQuery<{ n: number }>(orgId, ownerId, `select count(*)::int as n from public.${table} where org_id = $1`, [otherOrgId]);
      expect(leaked.n, `${table} leaked across orgs`).toBe(0);
    }
  });

  it('a forged context (org B named, a non-member user) sees nothing and writes nothing', async () => {
    for (const table of SITE_TABLES) {
      const [seen] = await appQuery<{ n: number }>(otherOrgId, ownerId, `select count(*)::int as n from public.${table}`);
      expect(seen.n, `${table} visible to a non-member`).toBe(0);
    }
    const theirs = await seedClientProject(otherOrgId);
    expect(await sqlstate(appInsert(otherOrgId, ownerId, 'site_visits', visitRow(otherOrgId, theirs.projectId, ownerId)))).toBe('42501');
  });

  it("org A cannot write a visit naming org B's project under its own org_id (23503)", async () => {
    const theirs = await seedClientProject(otherOrgId);
    expect(await sqlstate(appInsert(orgId, ownerId, 'site_visits', visitRow(orgId, theirs.projectId, ownerId)))).toBe('23503');
  });
});

describe('app_current_user_orgs_for_session: a revoked device loses that studio only', () => {
  it("drops the org whose device for THIS session is revoked, and keeps the user's other studio and other sessions", async () => {
    const userId = await seedMember(orgId, 'site_engineer');
    await ownerQuery(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'site_engineer')`, [otherOrgId, userId]);
    const revokedSession = randomUUID();
    const otherSession = randomUUID();
    await ownerInsert('site_devices', {
      org_id: orgId,
      user_id: userId,
      auth_session_id: revokedSession,
      label: 'Android',
      revoked_at: new Date().toISOString(),
      revoked_by: ownerId,
    });
    await ownerInsert('site_devices', { org_id: orgId, user_id: userId, auth_session_id: otherSession, label: 'iPhone' });
    const orgsFor = async (session: string) =>
      (
        await appQuery<{ org_id: string }>(orgId, userId, `select org_id from public.app_current_user_orgs_for_session($1) order by org_id`, [
          session,
        ])
      ).map((row) => row.org_id);
    expect(await orgsFor(revokedSession)).toEqual([otherOrgId]);
    expect(await orgsFor(otherSession)).toEqual([orgId, otherOrgId].sort());
    expect(await orgsFor(randomUUID())).toEqual([orgId, otherOrgId].sort());
  });

  it('returns exactly the columns and rows of app_current_user_orgs() for an unknown session', async () => {
    const [same] = await appQuery<{ same: boolean }>(
      orgId,
      ownerId,
      `select (select array_agg(o order by o.org_id) from public.app_current_user_orgs() o)
            = (select array_agg(s order by s.org_id) from public.app_current_user_orgs_for_session(gen_random_uuid()) s) as same`,
    );
    expect(same.same).toBe(true);
  });

  it("never reads another user's device rows (a revoke of someone else's same session id changes nothing)", async () => {
    const sessionId = randomUUID();
    await ownerInsert('site_devices', {
      org_id: orgId,
      user_id: randomUUID(),
      auth_session_id: sessionId,
      label: 'Shared',
      revoked_at: new Date().toISOString(),
      revoked_by: ownerId,
    });
    const rows = await appQuery<{ org_id: string }>(orgId, ownerId, `select org_id from public.app_current_user_orgs_for_session($1)`, [sessionId]);
    expect(rows.map((row) => row.org_id)).toEqual([orgId]);
  });
});
