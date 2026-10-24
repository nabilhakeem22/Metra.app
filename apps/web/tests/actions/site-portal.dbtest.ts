import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintShareToken } from '@/lib/share/token';
import { closeExecutionFixture, ownerQuery, seedClientProject } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';
import { ownerInsert, photoRow, visitRow } from './site-fixture';

// Site diary DB step S: the client's site updates by share token,
// app_delivery_site_updates_by_token (AC31, AC32). Only PUBLISHED visits, only
// client-visible, stored, non-void photos; null for a dead link, a delivery not
// in execution and a project with nothing published; never a location, a
// verdict, a person, a note or a delivery, in the output or in the source.

/** Every key the output may carry, by level. Anything else is a leak. */
const UPDATE_KEYS = ['caption_ar', 'caption_en', 'date', 'photos', 'published_at', 'visit_id'];
const PHOTO_KEYS = ['display_key', 'height', 'id', 'thumb_key', 'width'];

/** Words that name what the client must never see (O4). */
const FORBIDDEN = /(^|[^a-z])(lat|lng)([^a-z]|$)|accuracy|presence|distance|user|note|material|location|engineer|author|uploaded|recorded/i;

interface SiteUpdates {
  updates: Array<{
    visit_id: string;
    date: string;
    published_at: string;
    caption_ar: string | null;
    caption_en: string | null;
    photos: Array<{ id: string; display_key: string; thumb_key: string; width: number; height: number }>;
  }>;
  next_before: string | null;
}

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** A project with a delivery in `state` whose live link is the returned hash. */
async function seedDelivery(state = 'execution', expiresAt: string | null = null) {
  const { clientId, projectId } = await seedClientProject(orgId);
  const { hash } = mintShareToken();
  await ownerQuery(
    `insert into public.design_engagements (org_id, number, client_id, project_id, title_en, state, token_hash, share_expires_at)
     values ($1, (select coalesce(max(number), 0) + 1 from public.design_engagements where org_id = $1), $2, $3, 'Fit-out', $4, $5, $6)`,
    [orgId, clientId, projectId, state, hash, expiresAt],
  );
  return { projectId, hash };
}

/** A visit on `date`, published unless `published` is false, with `photos` photos. */
async function seedVisit(
  projectId: string,
  date: string,
  { published = true, photos = [] as Array<Record<string, unknown>> } = {},
): Promise<{ visitId: string; photoIds: string[] }> {
  const visitId = await ownerInsert(
    'site_visits',
    visitRow(orgId, projectId, ownerId, {
      visit_date: date,
      checked_in_at: `${date}T07:30:00Z`,
      location_status: 'fixed',
      lat: '30.044400',
      lng: '31.235700',
      accuracy_m: 20,
      presence: 'on_site',
      distance_m: 120,
      no_location_reason: null,
      ...(published ? { published_at: `${date}T18:00:00Z`, published_by: ownerId, client_caption_en: `Day ${date}` } : {}),
    }),
  );
  const photoIds: string[] = [];
  for (const [index, fields] of photos.entries()) {
    photoIds.push(
      await ownerInsert(
        'site_photos',
        photoRow(orgId, projectId, visitId, ownerId, {
          taken_at: `${date}T08:${String(10 + index).padStart(2, '0')}:00Z`,
          caption: 'internal caption',
          ...fields,
        }),
      ),
    );
  }
  return { visitId, photoIds };
}

const visible = { status: 'stored', client_visible: true };

async function updatesFor(hash: string, before: string | null = null, limit: number | null = 7): Promise<SiteUpdates | null> {
  const [row] = await ownerQuery<{ result: SiteUpdates | null }>(
    `select public.app_delivery_site_updates_by_token($1, $2::date, $3) as result`,
    [hash, before, limit],
  );
  return row.result;
}

describe('null, the same null, when there is nothing the client may see (AC31)', () => {
  it('for an unknown token, an expired link, a delivery not in execution, and a project with nothing published', async () => {
    const expired = await seedDelivery('execution', '2026-01-01T00:00:00Z');
    await seedVisit(expired.projectId, '2026-10-20', { photos: [visible] });
    const designOnly = await seedDelivery('closed_design_only');
    await seedVisit(designOnly.projectId, '2026-10-20', { photos: [visible] });
    const unpublished = await seedDelivery();
    await seedVisit(unpublished.projectId, '2026-10-20', { published: false, photos: [visible] });

    expect(await updatesFor(mintShareToken().hash)).toBeNull();
    expect(await updatesFor(expired.hash)).toBeNull();
    expect(await updatesFor(designOnly.hash)).toBeNull();
    expect(await updatesFor(unpublished.hash)).toBeNull();
  });

  it('answers an empty page, not null, for a cursor older than every published day', async () => {
    const delivery = await seedDelivery();
    await seedVisit(delivery.projectId, '2026-10-20');
    expect(await updatesFor(delivery.hash, '2026-10-01')).toEqual({ updates: [], next_before: null });
  });
});

describe('only published visits and client-visible, stored, non-void photos (AC31)', () => {
  it('leaves out unpublished visits, hidden, pending and void photos, and other projects', async () => {
    const delivery = await seedDelivery();
    const shown = await seedVisit(delivery.projectId, '2026-10-22', {
      photos: [visible, { status: 'stored' }, { status: 'pending' }, { ...visible }, { status: 'stored', voided_at: '2026-10-22T09:00:00Z', voided_by: ownerId }],
    });
    await seedVisit(delivery.projectId, '2026-10-22', { published: false, photos: [visible] });
    const sibling = await seedDelivery();
    await seedVisit(sibling.projectId, '2026-10-22', { photos: [visible] });

    const result = await updatesFor(delivery.hash);
    expect(result?.updates.map((update) => update.visit_id)).toEqual([shown.visitId]);
    expect(result?.updates[0].photos.map((photo) => photo.id)).toEqual([shown.photoIds[0], shown.photoIds[3]]);
    expect(result?.updates[0]).toMatchObject({ date: '2026-10-22', caption_en: 'Day 2026-10-22', caption_ar: null });
    expect(result?.next_before).toBeNull();
  });

  it('carries at most 20 photos per visit, in the order taken', async () => {
    const delivery = await seedDelivery();
    const crowded = await seedVisit(delivery.projectId, '2026-10-21', { photos: Array.from({ length: 22 }, () => visible) });
    const [update] = (await updatesFor(delivery.hash))?.updates ?? [];
    expect(update.photos.map((photo) => photo.id)).toEqual(crowded.photoIds.slice(0, 20));
  });

  it('removes a visit the moment it is unpublished (AC32)', async () => {
    const delivery = await seedDelivery();
    const kept = await seedVisit(delivery.projectId, '2026-10-19');
    const withdrawn = await seedVisit(delivery.projectId, '2026-10-20');
    expect((await updatesFor(delivery.hash))?.updates.map((update) => update.visit_id)).toEqual([withdrawn.visitId, kept.visitId]);
    await ownerQuery(`update public.site_visits set published_at = null, published_by = null where id = $1`, [withdrawn.visitId]);
    expect((await updatesFor(delivery.hash))?.updates.map((update) => update.visit_id)).toEqual([kept.visitId]);
  });
});

describe('pages by DAY with a date cursor that never splits a day', () => {
  it('returns p_limit days, every visit of each, and the cursor to the next page', async () => {
    const delivery = await seedDelivery();
    const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
    const byDay: Record<string, string[]> = {};
    for (const day of days) {
      byDay[day] = [(await seedVisit(delivery.projectId, day)).visitId, (await seedVisit(delivery.projectId, day)).visitId];
    }
    const first = await updatesFor(delivery.hash, null, 2);
    expect(new Set(first?.updates.map((update) => update.date))).toEqual(new Set(['2026-10-13', '2026-10-12']));
    expect(first?.updates).toHaveLength(4);
    expect(first?.next_before).toBe('2026-10-12');
    const second = await updatesFor(delivery.hash, first?.next_before ?? null, 2);
    expect(second?.updates.map((update) => update.visit_id).sort()).toEqual([...byDay['2026-10-11'], ...byDay['2026-10-10']].sort());
    expect(second?.next_before).toBeNull();
  });

  it('clamps p_limit to 1..14 (null means 7)', async () => {
    const delivery = await seedDelivery();
    for (let day = 1; day <= 16; day += 1) await seedVisit(delivery.projectId, `2026-09-${String(day).padStart(2, '0')}`);
    const daysIn = async (limit: number | null) => (await updatesFor(delivery.hash, null, limit))?.updates.length;
    expect(await daysIn(0)).toBe(1);
    expect(await daysIn(-5)).toBe(1);
    expect(await daysIn(null)).toBe(7);
    expect(await daysIn(99)).toBe(14);
  });
});

describe('never a location, a verdict, a person, a note or a delivery (AC31)', () => {
  it('carries exactly the client-safe keys, at every level', async () => {
    const delivery = await seedDelivery();
    await seedVisit(delivery.projectId, '2026-10-23', { photos: [visible] });
    const result = await updatesFor(delivery.hash);
    expect(Object.keys(result ?? {}).sort()).toEqual(['next_before', 'updates']);
    expect(Object.keys(result?.updates[0] ?? {}).sort()).toEqual(UPDATE_KEYS);
    expect(Object.keys(result?.updates[0].photos[0] ?? {}).sort()).toEqual(PHOTO_KEYS);
    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key);
          walk(inner);
        }
      }
    };
    walk(result);
    expect(keys.filter((key) => FORBIDDEN.test(key))).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('internal caption');
    expect(JSON.stringify(result)).not.toContain('30.0444');
  });

  it('names none of them in its source either (prosrc)', async () => {
    const [source] = await ownerQuery<{ prosrc: string; definer: boolean }>(
      `select prosrc, prosecdef as definer from pg_proc where proname = 'app_delivery_site_updates_by_token'`,
    );
    expect(source.definer).toBe(true);
    expect(source.prosrc.match(FORBIDDEN)).toBeNull();
  });

  it('never returns a key outside the studio and project prefix the row derives', async () => {
    const delivery = await seedDelivery();
    await seedVisit(delivery.projectId, '2026-10-23', { photos: [visible] });
    const [photo] = (await updatesFor(delivery.hash))?.updates[0].photos ?? [];
    expect(photo.display_key).toBe(`${orgId}/site/${delivery.projectId}/${photo.id}-d.jpg`);
    expect(photo.thumb_key).toBe(`${orgId}/site/${delivery.projectId}/${photo.id}-t.jpg`);
  });

  it('is callable by metra_app and by no API role or PUBLIC', async () => {
    const [row] = await ownerQuery<{ app: boolean; public_execute: boolean }>(
      `select has_function_privilege('metra_app', p.oid, 'execute') as app,
              exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute
         from pg_proc p where p.oid = 'public.app_delivery_site_updates_by_token(text, date, integer)'::regprocedure`,
    );
    expect(row).toEqual({ app: true, public_execute: false });
  });
});
