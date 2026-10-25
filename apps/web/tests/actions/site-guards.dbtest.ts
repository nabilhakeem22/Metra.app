import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appQuery, closeExecutionFixture, ownerQuery, seedClientProject, sqlstate } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';
import { appInsert, materialRow, noteRow, photoRow, visitRow } from './site-fixture';

// Site diary DB step S: a diary row is EVIDENCE (AC24). The guards in
// rls/functions/80-site.sql let an UPDATE change only the columns named for
// its table, keep a void and a check-out final, freeze a voided row whole, let
// a photo's status go only pending -> stored, let coordinates go only to null
// (the 90-day purge), derive a visit's date from its check-in, and refuse
// every DELETE, even from the connection role that owns the tables. Updates
// run as metra_app in an owner's context (a manager, so every "who" check of
// site-writers.dbtest.ts passes here).

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let projectId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
  ({ projectId } = await seedClientProject(orgId));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const app = (text: string, params: unknown[] = []) => appQuery(orgId, ownerId, text, params);
const newVisit = (fields = {}) => appInsert(orgId, ownerId, 'site_visits', visitRow(orgId, projectId, ownerId, fields));
const fixedVisit = () =>
  newVisit({ location_status: 'fixed', lat: '30.044400', lng: '31.235700', accuracy_m: 20, presence: 'on_site', distance_m: 120 });
const newPhoto = async () =>
  appInsert(orgId, ownerId, 'site_photos', photoRow(orgId, projectId, await newVisit(), ownerId));

describe('site_visits: only the check-out, the publication and the purge', () => {
  it('refuses a changed check-in time, verdict, author or reading (MT100)', async () => {
    const id = await fixedVisit();
    for (const change of [
      `checked_in_at = checked_in_at - interval '1 hour'`,
      `visit_date = visit_date - 1`,
      `presence = 'off_site'`,
      `distance_m = 5`,
      `accuracy_m = 5`,
      `user_id = gen_random_uuid()`,
      `received_at = now() - interval '1 day'`,
      `no_location_reason = 'edited'`,
    ]) {
      expect(await sqlstate(app(`update public.site_visits set ${change} where id = $1`, [id])), change).toBe('MT100');
    }
  });

  it('lets coordinates go to null (the purge) and never to another value (MT100)', async () => {
    const id = await fixedVisit();
    expect(await sqlstate(app(`update public.site_visits set lat = 30.1, lng = 31.3 where id = $1`, [id]))).toBe('MT100');
    await app(`update public.site_visits set lat = null, lng = null where id = $1`, [id]);
    expect(await sqlstate(app(`update public.site_visits set lat = 30.1, lng = 31.3 where id = $1`, [id]))).toBe('MT100');
    const [kept] = await ownerQuery<{ presence: string; distance_m: number; lat: string | null }>(
      `select presence, distance_m, lat from public.site_visits where id = $1`,
      [id],
    );
    expect(kept).toEqual({ presence: 'on_site', distance_m: 120, lat: null });
  });

  it('records a check-out once: a second, different time is MT100', async () => {
    const id = await newVisit();
    await app(`update public.site_visits set checked_out_at = '2026-10-24T15:00:00Z' where id = $1`, [id]);
    expect(
      await sqlstate(app(`update public.site_visits set checked_out_at = '2026-10-24T16:00:00Z' where id = $1`, [id])),
    ).toBe('MT100');
    expect(await sqlstate(app(`update public.site_visits set checked_out_at = null where id = $1`, [id]))).toBe('MT100');
  });

  it('publishes, re-captions and unpublishes freely (a manager, stamped with himself)', async () => {
    const id = await newVisit();
    await app(
      `update public.site_visits set published_at = now(), published_by = $2, client_caption_ar = 'تم', client_caption_en = 'Done', updated_at = now() where id = $1`,
      [id, ownerId],
    );
    await app(`update public.site_visits set client_caption_en = 'Tiling done' where id = $1`, [id]);
    await app(`update public.site_visits set published_at = null, published_by = null where id = $1`, [id]);
  });
});

describe("site_visits: the visit's date is the Cairo day of its check-in (S2 functional F3)", () => {
  const dateOf = async (id: string) =>
    (await ownerQuery<{ day: string }>(`select visit_date::text as day from public.site_visits where id = $1`, [id]))[0].day;

  it('derives it when the writer leaves it out, across Cairo midnight too', async () => {
    const evening = await newVisit({ visit_date: null, checked_in_at: '2026-10-23T20:30:00Z' });
    const pastMidnight = await newVisit({ visit_date: null, checked_in_at: '2026-10-23T22:30:00Z' });
    const winter = await newVisit({ visit_date: null, checked_in_at: '2026-12-15T22:01:00Z' });
    expect([await dateOf(evening), await dateOf(pastMidnight), await dateOf(winter)]).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-12-16',
    ]);
  });

  it('refuses a written date that is not that day (MT100), the repro of 1900-01-01 included', async () => {
    for (const [visitDate, checkedInAt] of [
      ['1900-01-01', '2026-10-24T09:00:00Z'],
      ['2026-10-23', '2026-10-23T22:30:00Z'],
    ]) {
      expect(
        await sqlstate(newVisit({ visit_date: visitDate, checked_in_at: checkedInAt })),
        `${visitDate} for ${checkedInAt}`,
      ).toBe('MT100');
    }
    await expect(newVisit({ visit_date: '2026-10-24', checked_in_at: '2026-10-23T22:30:00Z' })).resolves.toBeDefined();
  });
});

describe('site_photos: only status, client visibility, caption and the void', () => {
  it('refuses a changed size, time, source, author, key or visit (MT100)', async () => {
    const id = await newPhoto();
    for (const change of [
      `display_bytes = 1`,
      `width = 10`,
      `taken_at = now()`,
      `source = 'gallery'`,
      `uploaded_by = gen_random_uuid()`,
      `client_key = gen_random_uuid()`,
      `storage_provider = 'supabase'`,
    ]) {
      expect(await sqlstate(app(`update public.site_photos set ${change} where id = $1`, [id])), change).toBe('MT100');
    }
  });

  it('stores, shows, re-captions and hides a photo; a void is final', async () => {
    const id = await newPhoto();
    await app(`update public.site_photos set status = 'stored', updated_at = now() where id = $1`, [id]);
    await app(`update public.site_photos set client_visible = true, caption = 'Kitchen' where id = $1`, [id]);
    await app(`update public.site_photos set client_visible = false where id = $1`, [id]);
    await app(`update public.site_photos set voided_at = now(), voided_by = $2 where id = $1`, [id, ownerId]);
    expect(await sqlstate(app(`update public.site_photos set voided_at = null, voided_by = null where id = $1`, [id]))).toBe('MT100');
    expect(
      await sqlstate(app(`update public.site_photos set voided_at = now() - interval '1 day' where id = $1`, [id])),
    ).toBe('MT100');
  });

  it('never takes a stored photo back to pending (S2 functional F5, MT100)', async () => {
    const id = await newPhoto();
    await app(`update public.site_photos set status = 'stored' where id = $1`, [id]);
    expect(await sqlstate(app(`update public.site_photos set status = 'pending' where id = $1`, [id]))).toBe('MT100');
  });

  it('freezes a voided photo whole: no caption, status or stamp changes after the void (S2 functional F5, MT100)', async () => {
    const id = await newPhoto();
    await app(`update public.site_photos set voided_at = now(), voided_by = $2 where id = $1`, [id, ownerId]);
    for (const change of [`caption = 'changed after void'`, `status = 'stored'`, `updated_at = now() + interval '1 minute'`]) {
      expect(await sqlstate(app(`update public.site_photos set ${change} where id = $1`, [id])), change).toBe('MT100');
    }
  });
});

describe('site_material_receipts and site_notes: only the void', () => {
  it('refuses an edited description, quantity, note body or kind (MT100)', async () => {
    const visitId = await newVisit();
    const materialId = await appInsert(orgId, ownerId, 'site_material_receipts', materialRow(orgId, projectId, visitId, ownerId));
    const noteId = await appInsert(orgId, ownerId, 'site_notes', noteRow(orgId, projectId, visitId, ownerId));
    for (const change of [`description = 'Sand'`, `qty = 11`, `unit = 'ton'`, `supplier = 'X'`, `recorded_by = gen_random_uuid()`]) {
      expect(await sqlstate(app(`update public.site_material_receipts set ${change} where id = $1`, [materialId])), change).toBe('MT100');
    }
    for (const change of [`body = 'edited'`, `kind = 'issue'`, `author_id = gen_random_uuid()`]) {
      expect(await sqlstate(app(`update public.site_notes set ${change} where id = $1`, [noteId])), change).toBe('MT100');
    }
  });

  it('voids once, the void is final, and the voided row is frozen whole', async () => {
    const visitId = await newVisit();
    const noteId = await appInsert(orgId, ownerId, 'site_notes', noteRow(orgId, projectId, visitId, ownerId));
    await app(`update public.site_notes set voided_at = now(), voided_by = $2, updated_at = now() where id = $1`, [noteId, ownerId]);
    expect(await sqlstate(app(`update public.site_notes set voided_at = null, voided_by = null where id = $1`, [noteId]))).toBe('MT100');
    expect(await sqlstate(app(`update public.site_notes set updated_at = now() + interval '1 minute' where id = $1`, [noteId]))).toBe(
      'MT100',
    );
  });
});

describe('no diary row is ever deleted', () => {
  it('raises MT100 on a DELETE even from the connection role, which bypasses RLS and holds every grant', async () => {
    const visitId = await newVisit();
    const ids = {
      site_photos: await appInsert(orgId, ownerId, 'site_photos', photoRow(orgId, projectId, visitId, ownerId)),
      site_material_receipts: await appInsert(orgId, ownerId, 'site_material_receipts', materialRow(orgId, projectId, visitId, ownerId)),
      site_notes: await appInsert(orgId, ownerId, 'site_notes', noteRow(orgId, projectId, visitId, ownerId)),
      site_visits: visitId,
    };
    for (const [table, id] of Object.entries(ids)) {
      expect(await sqlstate(ownerQuery(`delete from public.${table} where id = $1`, [id])), table).toBe('MT100');
    }
  });
});
