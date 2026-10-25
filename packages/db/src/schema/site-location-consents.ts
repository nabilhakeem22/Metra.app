import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  smallint,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * An engineer's consent to share ONE location reading at each tapped check-in
 * (Stage 3, 0064; Egypt PDPL), per studio and per version of the consent text.
 * Withdrawal stamps `withdrawn_at`; check-in keeps working without location.
 * A new acceptance after a withdrawal is a new row, so the record of what was
 * agreed, and when, is kept (SELECT + INSERT + UPDATE, no DELETE).
 */
export const siteLocationConsents = pgTable(
  'site_location_consents',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull(),
    policyVersion: smallint('policy_version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [
    unique('site_location_consents_org_id_id_unique').on(t.orgId, t.id),
    check('site_location_consents_policy_version_positive', sql`policy_version > 0`),
    uniqueIndex('site_location_consents_one_live')
      .on(t.orgId, t.userId)
      .where(sql`withdrawn_at is null`),
  ],
);

export type SiteLocationConsent = typeof siteLocationConsents.$inferSelect;
export type NewSiteLocationConsent = typeof siteLocationConsents.$inferInsert;
