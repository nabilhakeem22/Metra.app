import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sitePhotoObjectKey, type SitePhotoVariant } from '@/lib/site/photo-object-key';
import { closeExecutionFixture, ownerQuery, sqlstate } from './execution-fixture';

// Site diary DB step S, S2 reliability R1: a site photo's object key is not
// stored; it is derived from (org_id, project_id, id), in SQL by
// public.site_photo_object_key (rls/functions/80-site.sql, used by the client's
// site updates) and in TypeScript by sitePhotoObjectKey (lib/site, used by the
// S5 photo store). The two must answer the SAME string for every photo, or a
// client would be shown a key nothing was ever uploaded to.

afterAll(async () => {
  await closeExecutionFixture();
});

const VARIANTS: SitePhotoVariant[] = ['display', 'thumb'];

describe('site_photo_object_key and sitePhotoObjectKey derive the same key', () => {
  it('for 50 random photos, both variants, the TypeScript fed upper-case ids', async () => {
    const photos = Array.from({ length: 50 }, () => ({ orgId: randomUUID(), projectId: randomUUID(), photoId: randomUUID() }));
    const rows = await ownerQuery<{ i: number; variant: SitePhotoVariant; key: string }>(
      `select p.i::int as i, v.variant, public.site_photo_object_key(p.org_id, p.project_id, p.photo_id, v.variant) as key
         from unnest($1::uuid[], $2::uuid[], $3::uuid[]) with ordinality as p(org_id, project_id, photo_id, i)
        cross join unnest($4::text[]) as v(variant)`,
      [photos.map((p) => p.orgId), photos.map((p) => p.projectId), photos.map((p) => p.photoId), VARIANTS],
    );
    expect(rows).toHaveLength(100);
    for (const row of rows) {
      const photo = photos[row.i - 1];
      const shouted = { orgId: photo.orgId.toUpperCase(), projectId: photo.projectId.toUpperCase(), photoId: photo.photoId.toUpperCase() };
      expect(row.key).toBe(sitePhotoObjectKey(photo, row.variant));
      expect(row.key).toBe(sitePhotoObjectKey(shouted, row.variant));
    }
  });

  it('answers null for a null id (STRICT) and refuses a variant that is not display or thumb (22023)', async () => {
    const [nulled] = await ownerQuery<{ key: string | null }>(
      `select public.site_photo_object_key(null, gen_random_uuid(), gen_random_uuid(), 'display') as key`,
    );
    expect(nulled.key).toBeNull();
    expect(
      await sqlstate(ownerQuery(`select public.site_photo_object_key(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'original')`)),
    ).toBe('22023');
  });

  it('is IMMUTABLE and not a definer function', async () => {
    const [fn] = await ownerQuery<{ volatile: string; definer: boolean }>(
      `select provolatile as volatile, prosecdef as definer from pg_proc
        where oid = 'public.site_photo_object_key(uuid, uuid, uuid, text)'::regprocedure`,
    );
    expect(fn).toEqual({ volatile: 'i', definer: false });
  });
});
