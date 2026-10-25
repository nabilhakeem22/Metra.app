import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sitePhotoSource, sitePhotoStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameProjectFk } from './org-ref';
import { siteVisits } from './site-visits';

/**
 * A site photo (Stage 3, 0064): two JPEG objects in object storage (a display
 * copy and a thumbnail, compressed on the phone, EXIF stripped), never bytes in
 * the database. `pending` until the server has seen both objects (`stored`).
 *
 * THE OBJECT KEYS ARE NOT STORED: they are a pure function of the row,
 * `{org_id}/site/{project_id}/{id}-d.jpg` and `-t.jpg`
 * (`site_photo_object_key` in rls/functions/80-site.sql, and its TypeScript
 * twin apps/web/src/lib/site/photo-object-key.ts), so a row can only ever point
 * inside its own studio's and project's prefix, whatever a writer sends, and
 * the keys cost no bytes (S2 reliability R1).
 *
 * EVIDENCE: `trg_site_photos_guard` lets an UPDATE change only `status`,
 * `client_visible`, `caption` and the void pair (once), and freezes a voided
 * photo whole; `trg_site_photos_state` lets `status` go only pending -> stored
 * and lets only a manager change what the client sees. No DELETE grant. A
 * photo the client sees is stored and never void (the two CHECKs below).
 * `unique (org_id, project_id, id)` is the target of a material's 3-column
 * photo FK.
 */
export const sitePhotos = pgTable(
  'site_photos',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    clientKey: uuid('client_key').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    storageProvider: text('storage_provider').notNull(),
    displayBytes: integer('display_bytes').notNull(),
    thumbBytes: integer('thumb_bytes').notNull(),
    width: smallint('width').notNull(),
    height: smallint('height').notNull(),
    contentType: text('content_type').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
    source: sitePhotoSource('source').notNull(),
    caption: text('caption'),
    status: sitePhotoStatus('status').notNull().default('pending'),
    clientVisible: boolean('client_visible').notNull().default(false),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
  },
  (t) => [
    unique('site_photos_org_id_id_unique').on(t.orgId, t.id),
    unique('site_photos_org_client_key_unique').on(t.orgId, t.clientKey),
    unique('site_photos_org_project_id_unique').on(t.orgId, t.projectId, t.id),
    check('site_photos_storage_provider', sql`storage_provider in ('r2', 'supabase')`),
    check('site_photos_display_bytes_range', sql`display_bytes between 1 and 1048576`),
    check('site_photos_thumb_bytes_range', sql`thumb_bytes between 1 and 131072`),
    check('site_photos_dimensions_range', sql`width between 1 and 4096 and height between 1 and 4096`),
    check('site_photos_content_type', sql`content_type = 'image/jpeg'`),
    check('site_photos_caption_length', sql`char_length(caption) <= 300`),
    check('site_photos_visible_is_stored', sql`not client_visible or status = 'stored'`),
    check('site_photos_void_pair', sql`(voided_at is null) = (voided_by is null)`),
    check('site_photos_visible_not_void', sql`not (client_visible and voided_at is not null)`),
    sameProjectFk(t, 'visit', siteVisits),
    index('site_photos_org_visit_idx').on(t.orgId, t.visitId),
    index('site_photos_org_project_created_idx').on(t.orgId, t.projectId, t.createdAt.desc().nullsFirst()),
  ],
);

export type SitePhoto = typeof sitePhotos.$inferSelect;
export type NewSitePhoto = typeof sitePhotos.$inferInsert;
