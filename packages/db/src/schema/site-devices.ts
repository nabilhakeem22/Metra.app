import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * A phone signed in to the site app, per (studio, auth session) (Stage 3,
 * 0064). `auth_session_id` is the Supabase JWT `session_id` claim. Revoking a
 * device stamps `revoked_at` / `revoked_by`: that session then loses THIS
 * studio on its next request, in the app and in the studio pages
 * (`app_current_user_orgs_for_session` leaves the org out). Never deleted.
 *
 * WHO (rls/policies/70-site.sql): only the phone itself registers, for the
 * current user and the auth session the request names in the GUC
 * `app.current_session_id` (the register path sets it from the verified JWT;
 * unset, no app insert passes), born live; a member reads and revokes only his
 * own phones, a manager every phone of the studio; `user_id` and
 * `auth_session_id` never change.
 */
export const siteDevices = pgTable(
  'site_devices',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull(),
    authSessionId: uuid('auth_session_id').notNull(),
    label: text('label').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
  },
  (t) => [
    unique('site_devices_org_id_id_unique').on(t.orgId, t.id),
    unique('site_devices_org_session_unique').on(t.orgId, t.authSessionId),
    check('site_devices_label_length', sql`char_length(label) between 1 and 80`),
    check('site_devices_revoke_pair', sql`(revoked_at is null) = (revoked_by is null)`),
    index('site_devices_org_user_idx').on(t.orgId, t.userId),
  ],
);

export type SiteDevice = typeof siteDevices.$inferSelect;
export type NewSiteDevice = typeof siteDevices.$inferInsert;
