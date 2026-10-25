import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintShareToken } from '@/lib/share/token';
import { closeExecutionFixture, ownerQuery, seedClientProject, sqlstate } from './execution-fixture';
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
  type Row,
} from './site-fixture';

// Site diary DB step S, S2 re-check N1: for metra_app an INSERT refuses what an
// UPDATE refuses. The guards in rls/functions/80-site.sql ask an insert what
// they ask the update from the row as it is recorded (unpublished, pending,
// hidden, uncaptioned, live), so an assigned engineer cannot insert a visit
// already published, a photo already stored, shown or captioned, or an entry
// already voided, in his name or anyone else's. Each case is a repro of the
// re-check (t11, t12); every refusal is MT100. Every statement runs as
// metra_app in the named member's org context.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let pmId: string;
let engineerId: string;
let projectId: string;
let visitId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
  pmId = await seedMember(orgId, 'project_manager');
  engineerId = await seedMember(orgId, 'site_engineer');
  ({ projectId } = await seedClientProject(orgId));
  await seedAssignment(orgId, projectId, engineerId, ownerId);
  visitId = await ownerInsert('site_visits', visitRow(orgId, projectId, engineerId));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const now = () => new Date().toISOString();
const insertAs = (userId: string, table: string, row: Row) => appInsert(orgId, userId, table, row);
const visitBy = (userId: string, fields: Row = {}) => insertAs(userId, 'site_visits', visitRow(orgId, projectId, userId, fields));
const photoBy = (userId: string, fields: Row = {}) => insertAs(userId, 'site_photos', photoRow(orgId, projectId, visitId, userId, fields));

describe('site_visits: only a manager inserts a published or captioned visit, stamped with himself', () => {
  it('refuses the assigned engineer inserting a visit already published or captioned (t11 I1, I1b; MT100)', async () => {
    const cases: Array<[string, Row]> = [
      ['published by himself, with a caption', { published_at: now(), published_by: engineerId, client_caption_en: 'self-published' }],
      ['published in the owner name', { published_at: now(), published_by: ownerId, client_caption_en: 'forged' }],
      ['an Arabic client caption alone', { client_caption_ar: 'تم' }],
      ['an English client caption alone', { client_caption_en: 'Done' }],
    ];
    for (const [label, fields] of cases) expect(await sqlstate(visitBy(engineerId, fields)), label).toBe('MT100');
  });

  it('lets him insert the plain check-in, checked out or not', async () => {
    await expect(visitBy(engineerId)).resolves.toBeDefined();
    await expect(visitBy(engineerId, { checked_out_at: '2026-10-24T15:00:00Z' })).resolves.toBeDefined();
  });

  it("lets a manager insert it published and captioned, stamped with himself, and never in someone else's name (MT100)", async () => {
    await expect(visitBy(pmId, { published_at: now(), published_by: pmId, client_caption_en: 'Done' })).resolves.toBeDefined();
    await expect(visitBy(ownerId, { client_caption_ar: 'تم' })).resolves.toBeDefined();
    expect(await sqlstate(visitBy(pmId, { published_at: now(), published_by: ownerId }))).toBe('MT100');
  });
});

describe('site_photos: a photo is recorded pending, hidden, uncaptioned (but by a manager) and live', () => {
  it('refuses the assigned engineer inserting a photo stored, shown, captioned or voided (t11 I2, I3; MT100)', async () => {
    const cases: Array<[string, Row]> = [
      ['stored, shown and captioned', { status: 'stored', client_visible: true, caption: 'engineer-chosen caption' }],
      ['stored', { status: 'stored' }],
      ['shown', { client_visible: true }],
      ['captioned', { caption: 'Kitchen' }],
      ['voided in the owner name', { voided_at: now(), voided_by: ownerId }],
      ['voided by himself', { voided_at: now(), voided_by: engineerId }],
    ];
    for (const [label, fields] of cases) expect(await sqlstate(photoBy(engineerId, fields)), label).toBe('MT100');
    await expect(photoBy(engineerId)).resolves.toBeDefined();
  });

  it('refuses even the owner inserting a photo already stored or voided (MT100), and lets a manager caption it', async () => {
    expect(await sqlstate(photoBy(ownerId, { status: 'stored' })), 'stored').toBe('MT100');
    expect(await sqlstate(photoBy(ownerId, { voided_at: now(), voided_by: ownerId })), 'voided').toBe('MT100');
    await expect(photoBy(pmId, { caption: 'Kitchen' })).resolves.toBeDefined();
  });
});

describe('site_material_receipts and site_notes: an entry is recorded live', () => {
  it('refuses an entry inserted already voided, by the engineer or the owner, in any name (t11 I4; MT100)', async () => {
    for (const userId of [engineerId, ownerId]) {
      for (const voidedBy of [userId, ownerId]) {
        const voided = { voided_at: now(), voided_by: voidedBy };
        expect(
          await sqlstate(insertAs(userId, 'site_material_receipts', materialRow(orgId, projectId, visitId, userId, voided))),
          'material',
        ).toBe('MT100');
        expect(await sqlstate(insertAs(userId, 'site_notes', noteRow(orgId, projectId, visitId, userId, voided))), 'note').toBe(
          'MT100',
        );
      }
    }
    await expect(insertAs(engineerId, 'site_notes', noteRow(orgId, projectId, visitId, engineerId))).resolves.toBeDefined();
  });
});

describe('project_assignments: an assignment is recorded live', () => {
  it('refuses a manager inserting an assignment already revoked (42501)', async () => {
    const someone = await seedMember(orgId, 'site_engineer');
    expect(
      await sqlstate(
        insertAs(pmId, 'project_assignments', {
          org_id: orgId,
          project_id: projectId,
          user_id: someone,
          assigned_by: pmId,
          revoked_at: now(),
          revoked_by: ownerId,
        }),
      ),
    ).toBe('42501');
  });
});

describe('end to end: nothing an engineer inserts reaches the client page on its own (t12)', () => {
  it('refuses the self-published visit and its shown photo; the client token sees only what a manager published', async () => {
    const { clientId, projectId: deliveredProjectId } = await seedClientProject(orgId);
    const { hash } = mintShareToken();
    await ownerQuery(
      `insert into public.design_engagements (org_id, number, client_id, project_id, title_en, state, token_hash)
       values ($1, (select coalesce(max(number), 0) + 1 from public.design_engagements where org_id = $1), $2, $3, 'Fit-out', 'execution', $4)`,
      [orgId, clientId, deliveredProjectId, hash],
    );
    await seedAssignment(orgId, deliveredProjectId, engineerId, ownerId);
    const engineerVisit = await insertAs(engineerId, 'site_visits', visitRow(orgId, deliveredProjectId, engineerId));
    const published = { published_at: now(), client_caption_en: 'Engineer-written text for the client' };
    expect(
      await sqlstate(insertAs(engineerId, 'site_visits', visitRow(orgId, deliveredProjectId, engineerId, { ...published, published_by: ownerId }))),
    ).toBe('MT100');
    expect(
      await sqlstate(
        insertAs(
          engineerId,
          'site_photos',
          photoRow(orgId, deliveredProjectId, engineerVisit, engineerId, { status: 'stored', client_visible: true, caption: 'x' }),
        ),
      ),
    ).toBe('MT100');
    const clientSees = async () =>
      (await ownerQuery<{ result: { updates: Array<{ visit_id: string }> } | null }>(
        `select public.app_delivery_site_updates_by_token($1, null, 14) as result`,
        [hash],
      ))[0].result;
    expect(await clientSees()).toBeNull();

    const managerVisit = await insertAs(pmId, 'site_visits', visitRow(orgId, deliveredProjectId, pmId, { published_at: now(), published_by: pmId }));
    expect((await clientSees())?.updates.map((update) => update.visit_id)).toEqual([managerVisit]);
  });
});
