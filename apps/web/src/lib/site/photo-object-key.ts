// A site photo's object key (Stage 3 site app, S2 reliability R1): where its
// display copy and its thumbnail live in object storage. PURE and CLIENT-SAFE.
//
// The database stores NO key: a key is a pure function of the photo row,
// `{org_id}/site/{project_id}/{photo_id}-d.jpg` and `-t.jpg`, so it can only
// point inside the row's own studio and project. This is the TypeScript twin of
// `public.site_photo_object_key` (rls/functions/80-site.sql), which the
// client's site updates use; the S5 photo store presigns with this one.
// site-photo-key.dbtest.ts holds the two to the same string.
import { isUuid } from '@/lib/uuid';

export type SitePhotoVariant = 'display' | 'thumb';

export interface SitePhotoIds {
  orgId: string;
  projectId: string;
  photoId: string;
}

const SUFFIX: Record<SitePhotoVariant, string> = { display: '-d.jpg', thumb: '-t.jpg' };

/**
 * The object key of one variant of a photo. Postgres writes a uuid's text in
 * lower case, so the ids are lower-cased here too. An id that is not a uuid is
 * a caller bug (the database's `::uuid` would refuse it too): RangeError.
 */
export function sitePhotoObjectKey(ids: SitePhotoIds, variant: SitePhotoVariant): string {
  const parts = [ids.orgId, ids.projectId, ids.photoId];
  if (!parts.every(isUuid)) throw new RangeError('sitePhotoObjectKey needs a uuid org, project and photo id.');
  const [orgId, projectId, photoId] = parts.map((id) => id.toLowerCase());
  return `${orgId}/site/${projectId}/${photoId}${SUFFIX[variant]}`;
}
