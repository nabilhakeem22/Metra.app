import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { siteLocationStatus, sitePresence } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projects } from './projects';

/**
 * One site visit of one engineer (Stage 3, 0064): the check-in, the optional
 * single location reading, the server's presence verdict, the check-out, and
 * the studio's publication to the client. The diary's photos, materials and
 * notes hang off it through 3-column FKs (org_id, project_id, visit_id), so an
 * entry can only name a visit of its own project.
 *
 * EVIDENCE: `trg_site_visits_guard` (rls/functions/80-site.sql) refuses every
 * UPDATE except the check-out (once), the publication columns, and the 90-day
 * purge that nulls `lat` / `lng` (never to another value). No DELETE grant.
 *
 * `visit_date` is the Africa/Cairo date of `checked_in_at` (the device clock),
 * derived by the server; `received_at` is the server's own clock, so a late
 * upload is visible. `client_key` is the phone's idempotency key.
 */
export const siteVisits = pgTable(
  'site_visits',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id').notNull(),
    clientKey: uuid('client_key').notNull(),
    visitDate: date('visit_date').notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    locationStatus: siteLocationStatus('location_status').notNull(),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),
    accuracyM: integer('accuracy_m'),
    presence: sitePresence('presence').notNull(),
    distanceM: integer('distance_m'),
    noLocationReason: text('no_location_reason'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by'),
    clientCaptionAr: text('client_caption_ar'),
    clientCaptionEn: text('client_caption_en'),
  },
  (t) => [
    unique('site_visits_org_id_id_unique').on(t.orgId, t.id),
    unique('site_visits_org_client_key_unique').on(t.orgId, t.clientKey),
    unique('site_visits_org_project_id_unique').on(t.orgId, t.projectId, t.id),
    check(
      'site_visits_checkout_order',
      sql`checked_out_at is null or checked_out_at >= checked_in_at`,
    ),
    // A reading has an accuracy; coordinates are both set or both null, and only
    // on a reading (a `fixed` row loses them at the 90-day purge, keeps the rest).
    check(
      'site_visits_fix_shape',
      sql`(location_status = 'fixed') = (accuracy_m is not null) and (lat is null) = (lng is null) and (lat is null or location_status = 'fixed')`,
    ),
    check(
      'site_visits_coordinates_range',
      sql`lat between -90 and 90 and lng between -180 and 180 and accuracy_m between 0 and 100000`,
    ),
    // A distance exists exactly when there was a reading and a pin to measure;
    // a reading is never `no_location`, and no reading is never a verdict.
    check(
      'site_visits_verdict_shape',
      sql`(distance_m is null) = (presence in ('no_location', 'no_site_pin')) and distance_m >= 0 and (presence = 'no_location') = (location_status <> 'fixed' and presence <> 'no_site_pin')`,
    ),
    check('site_visits_reason_length', sql`char_length(no_location_reason) <= 200`),
    check(
      'site_visits_publish_pair',
      sql`(published_at is null) = (published_by is null)`,
    ),
    check(
      'site_visits_caption_length',
      sql`char_length(client_caption_ar) <= 500 and char_length(client_caption_en) <= 500`,
    ),
    // `index: false`: the feed index below leads with the same two columns.
    ...sameOrgFk(t, 'project', projects, { onDelete: 'restrict', index: false }),
    // The studio feed and the engineer's days, newest first.
    index('site_visits_org_project_feed_idx').on(
      t.orgId,
      t.projectId,
      t.visitDate.desc().nullsFirst(),
      t.checkedInAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('site_visits_org_user_date_idx').on(t.orgId, t.userId, t.visitDate.desc().nullsFirst()),
    // The client feed: published visits only.
    index('site_visits_org_project_published_idx')
      .on(t.orgId, t.projectId, t.visitDate.desc().nullsFirst())
      .where(sql`published_at is not null`),
  ],
);

export type SiteVisit = typeof siteVisits.$inferSelect;
export type NewSiteVisit = typeof siteVisits.$inferInsert;
