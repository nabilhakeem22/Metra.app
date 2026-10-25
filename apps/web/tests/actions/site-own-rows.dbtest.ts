import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appQuery, appQueryInSession, closeExecutionFixture, ownerQuery, seedClientProject, sqlstate } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';
import {
  appInsert,
  appInsertInSession,
  materialRow,
  noteRow,
  photoRow,
  seedAssignment,
  seedMember,
  visitRow,
  type Row,
} from './site-fixture';

// Site diary DB step S, the S2 re-check's "own row" rulings, each repro kept
// (t13, t14). For metra_app, a non-manager acts only on his own rows and a
// manager (owner, admin, project_manager) on every row of the studio:
//   N2  the diary: void an entry he authored, check out his own visit, mark
//       stored a photo he uploaded; purging coordinates before 90 days is a
//       manager's;
//   N3  site_devices: register only his own phone in his own auth session,
//       read and revoke only his own phones;
//   N4  project_assignments (and site_devices): who a row is about never
//       changes, for anyone.
// A restrictive policy refusal is 42501 on insert and 0 rows on read and
// update; a guard refusal is MT100.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let pmId: string;
let engineerId: string;
let peerId: string;
let viewerId: string;
let projectId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
  pmId = await seedMember(orgId, 'project_manager');
  engineerId = await seedMember(orgId, 'site_engineer');
  peerId = await seedMember(orgId, 'site_engineer');
  viewerId = await seedMember(orgId, 'viewer');
  ({ projectId } = await seedClientProject(orgId));
  await seedAssignment(orgId, projectId, engineerId, ownerId);
  await seedAssignment(orgId, projectId, peerId, ownerId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const as = (userId: string, text: string, params: unknown[] = []) => appQuery<{ id: string }>(orgId, userId, text, params);
/** How many rows an UPDATE ... RETURNING id touched as `userId`. */
const touched = async (userId: string, text: string, params: unknown[] = []) => (await as(userId, `${text} returning id`, params)).length;
const FIX: Row = { location_status: 'fixed', lat: '30.044400', lng: '31.235700', accuracy_m: 20, presence: 'on_site', distance_m: 120 };

/** One of each diary row, made by `authorId` as metra_app on the shared project. */
async function diaryOf(authorId: string, visitFields: Row = {}) {
  const visitId = await appInsert(orgId, authorId, 'site_visits', visitRow(orgId, projectId, authorId, { ...FIX, ...visitFields }));
  return {
    visitId,
    noteId: await appInsert(orgId, authorId, 'site_notes', noteRow(orgId, projectId, visitId, authorId)),
    materialId: await appInsert(orgId, authorId, 'site_material_receipts', materialRow(orgId, projectId, visitId, authorId)),
    photoId: await appInsert(orgId, authorId, 'site_photos', photoRow(orgId, projectId, visitId, authorId)),
  };
}

const voidSql = (table: string) => `update public.${table} set voided_at = now(), voided_by = $2 where id = $1`;
const checkOut = `update public.site_visits set checked_out_at = now() where id = $1`;
const markStored = `update public.site_photos set status = 'stored' where id = $1`;
const purge = `update public.site_visits set lat = null, lng = null where id = $1`;

describe("the diary: a non-manager acts on his own entries only (N2)", () => {
  it("refuses an assigned engineer voiding, checking out or storing a colleague's rows (t14 B1, B1b, B1c, B2, A5; MT100)", async () => {
    const theirs = await diaryOf(pmId);
    const peers = await diaryOf(peerId);
    for (const rows of [theirs, peers]) {
      expect(await sqlstate(as(engineerId, voidSql('site_notes'), [rows.noteId, engineerId])), 'void the note').toBe('MT100');
      expect(await sqlstate(as(engineerId, voidSql('site_material_receipts'), [rows.materialId, engineerId])), 'void the delivery').toBe(
        'MT100',
      );
      expect(await sqlstate(as(engineerId, voidSql('site_photos'), [rows.photoId, engineerId])), 'void the photo').toBe('MT100');
      expect(await sqlstate(as(engineerId, checkOut, [rows.visitId])), 'check out the visit').toBe('MT100');
      expect(await sqlstate(as(engineerId, markStored, [rows.photoId])), 'mark the photo stored').toBe('MT100');
    }
  });

  it('lets him void, check out and store his own', async () => {
    const mine = await diaryOf(engineerId);
    expect(await touched(engineerId, checkOut, [mine.visitId])).toBe(1);
    expect(await touched(engineerId, markStored, [mine.photoId])).toBe(1);
    for (const [table, id] of [
      ['site_notes', mine.noteId],
      ['site_material_receipts', mine.materialId],
      ['site_photos', mine.photoId],
    ]) {
      expect(await touched(engineerId, voidSql(table), [id, engineerId]), table).toBe(1);
    }
  });

  it("lets a manager void, check out and store anyone's rows, stamped with himself", async () => {
    for (const managerId of [pmId, ownerId]) {
      const engineers = await diaryOf(engineerId);
      expect(await touched(managerId, checkOut, [engineers.visitId])).toBe(1);
      expect(await touched(managerId, markStored, [engineers.photoId])).toBe(1);
      for (const [table, id] of [
        ['site_notes', engineers.noteId],
        ['site_material_receipts', engineers.materialId],
        ['site_photos', engineers.photoId],
      ]) {
        expect(await touched(managerId, voidSql(table), [id, managerId]), table).toBe(1);
      }
    }
  });
});

describe('the coordinate purge: before 90 days it is a manager\'s (N2)', () => {
  const visitAged = (authorId: string, days: number) =>
    appInsert(
      orgId,
      authorId,
      'site_visits',
      visitRow(orgId, projectId, authorId, {
        ...FIX,
        visit_date: null,
        checked_in_at: new Date(Date.now() - days * 86_400_000).toISOString(),
      }),
    );

  it("refuses an assigned engineer purging a visit younger than 90 days, his own or a colleague's (t14 B2b, B2c; MT100)", async () => {
    expect(await sqlstate(as(engineerId, purge, [await visitAged(engineerId, 0)])), 'his own').toBe('MT100');
    expect(await sqlstate(as(engineerId, purge, [await visitAged(pmId, 89)])), "the PM's").toBe('MT100');
  });

  it('lets him null the coordinates of a visit past 90 days (the purge is due)', async () => {
    expect(await touched(engineerId, purge, [await visitAged(engineerId, 91)])).toBe(1);
  });

  it('lets a manager purge early, and the hourly purge (owner or admin, the system context) purge what is due', async () => {
    expect(await touched(pmId, purge, [await visitAged(engineerId, 0)])).toBe(1);
    const due = await visitAged(engineerId, 120);
    expect(
      await touched(
        ownerId,
        `update public.site_visits set lat = null, lng = null
          where org_id = $1 and lat is not null and checked_in_at < now() - interval '90 days'`,
        [orgId],
      ),
    ).toBeGreaterThanOrEqual(1);
    const [kept] = await ownerQuery<{ lat: string | null; presence: string }>(`select lat, presence from public.site_visits where id = $1`, [due]);
    expect(kept).toEqual({ lat: null, presence: 'on_site' });
  });
});

describe('site_devices: a member registers, reads and revokes only his own phone (N3)', () => {
  const deviceRow = (userId: string, sessionId: string, fields: Row = {}): Row => ({
    org_id: orgId,
    user_id: userId,
    auth_session_id: sessionId,
    label: 'Android · Chrome',
    ...fields,
  });
  let engineerSession: string;
  let engineerDevice: string;

  beforeAll(async () => {
    engineerSession = randomUUID();
    engineerDevice = await appInsertInSession(orgId, engineerId, engineerSession, 'site_devices', deviceRow(engineerId, engineerSession));
  });

  it("refuses a device row for someone else, for another session, with no session, or already revoked (t13 F2; 42501)", async () => {
    const forged = randomUUID();
    const cases: Array<[string, string, string, Row]> = [
      ["the viewer, for the engineer's user, in the session he names", viewerId, forged, deviceRow(engineerId, forged)],
      ['the viewer, for himself, in a session that is not his', viewerId, randomUUID(), deviceRow(viewerId, forged)],
      ['the owner, for the engineer', ownerId, forged, deviceRow(engineerId, forged)],
      ['no session at all', viewerId, '', deviceRow(viewerId, forged)],
      ['already revoked', viewerId, forged, deviceRow(viewerId, forged, { revoked_at: new Date().toISOString(), revoked_by: ownerId })],
    ];
    for (const [label, userId, sessionId, row] of cases) {
      expect(await sqlstate(appInsertInSession(orgId, userId, sessionId, 'site_devices', row)), label).toBe('42501');
    }
  });

  it("hides every other member's phone from a non-manager, auth_session_id included, and shows a manager all of them", async () => {
    const countFor = async (userId: string) =>
      (
        await appQuery<{ n: number }>(orgId, userId, `select count(*)::int as n from public.site_devices where auth_session_id = $1`, [
          engineerSession,
        ])
      )[0].n;
    expect(await countFor(viewerId), 'the viewer').toBe(0);
    expect(await countFor(peerId), 'a peer engineer').toBe(0);
    expect(await countFor(engineerId), 'his own').toBe(1);
    expect(await countFor(pmId), 'the project manager').toBe(1);
  });

  it("refuses a non-manager revoking or re-pointing someone else's phone (t13 F1, F4; 0 rows)", async () => {
    expect(
      await touched(viewerId, `update public.site_devices set revoked_at = now(), revoked_by = $2 where id = $1`, [engineerDevice, viewerId]),
    ).toBe(0);
    expect(await touched(viewerId, `update public.site_devices set user_id = $2, label = 'mine' where id = $1`, [engineerDevice, viewerId])).toBe(0);
    expect(await touched(peerId, `update public.site_devices set last_seen_at = now() where id = $1`, [engineerDevice])).toBe(0);
  });

  it('keeps who a phone is and which session it is fixed, even for its owner and a manager (t13 F4; MT100)', async () => {
    for (const userId of [engineerId, ownerId]) {
      expect(await sqlstate(as(userId, `update public.site_devices set user_id = $2 where id = $1`, [engineerDevice, viewerId])), userId).toBe(
        'MT100',
      );
      expect(
        await sqlstate(as(userId, `update public.site_devices set auth_session_id = $2 where id = $1`, [engineerDevice, randomUUID()])),
        userId,
      ).toBe('MT100');
    }
  });

  it("keeps the engineer's studio for his session while others try (t13 F3), and drops it once he or a manager revokes", async () => {
    const orgsFor = async (userId: string, sessionId: string) =>
      (await appQuery<{ org_id: string }>(orgId, userId, `select org_id from public.app_current_user_orgs_for_session($1)`, [sessionId])).map(
        (row) => row.org_id,
      );
    expect(await orgsFor(engineerId, engineerSession)).toEqual([orgId]);
    expect(await touched(engineerId, `update public.site_devices set last_seen_at = now() where id = $1`, [engineerDevice])).toBe(1);

    const managerRevoked = randomUUID();
    const phone = await appInsertInSession(orgId, engineerId, managerRevoked, 'site_devices', deviceRow(engineerId, managerRevoked));
    expect(await touched(pmId, `update public.site_devices set revoked_at = now(), revoked_by = $2 where id = $1`, [phone, pmId])).toBe(1);
    expect(await orgsFor(engineerId, managerRevoked)).toEqual([]);

    expect(
      await touched(engineerId, `update public.site_devices set revoked_at = now(), revoked_by = $2 where id = $1`, [engineerDevice, engineerId]),
    ).toBe(1);
    expect(await orgsFor(engineerId, engineerSession)).toEqual([]);
    expect(await orgsFor(engineerId, randomUUID())).toEqual([orgId]);
  });

  it('registers the phone of the session the request runs in', async () => {
    const sessionId = randomUUID();
    const [row] = await appQueryInSession<{ user_id: string }>(
      orgId,
      viewerId,
      sessionId,
      `insert into public.site_devices (org_id, user_id, auth_session_id, label) values ($1, $2, $3, 'iPhone') returning user_id`,
      [orgId, viewerId, sessionId],
    );
    expect(row.user_id).toBe(viewerId);
  });
});

describe('project_assignments: who an assignment is about never changes (N4)', () => {
  it('refuses a manager rewriting the assigner, re-pointing the engineer or moving the project (t13 D3, D4; MT100)', async () => {
    const { projectId: otherProjectId } = await seedClientProject(orgId);
    const assignmentId = await seedAssignment(orgId, otherProjectId, engineerId, pmId);
    for (const [column, value] of [
      ['assigned_by', ownerId],
      ['user_id', peerId],
      ['project_id', projectId],
    ]) {
      const rewrite = `update public.project_assignments set ${column} = $2 where id = $1`;
      expect(await sqlstate(as(pmId, rewrite, [assignmentId, value])), `the PM rewrites ${column}`).toBe('MT100');
      expect(await sqlstate(as(ownerId, rewrite, [assignmentId, value])), `the owner rewrites ${column}`).toBe('MT100');
      expect(await sqlstate(ownerQuery(rewrite, [assignmentId, value])), `the connection role rewrites ${column}`).toBe('MT100');
    }
    expect(
      await touched(pmId, `update public.project_assignments set revoked_at = now(), revoked_by = $2 where id = $1`, [assignmentId, pmId]),
    ).toBe(1);
  });
});
