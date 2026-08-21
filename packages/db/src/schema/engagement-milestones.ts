import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { designEngagements } from './design-engagements';
import { milestoneBasis, milestoneKind } from './enums';
import { money } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Design-fee milestone schedule (Design-Engagement Machine, Step 3). Written by
 * the `generateFeeSchedule` side-effect of `submitDesignFee` — one row per
 * milestone `kind` on an engagement. Unlike the append-only transition ledger,
 * these rows are EDITABLE while the engagement's fee is being set up (full DML in
 * roles.sql).
 *
 * `basis` decides how `value` reads: `percent` (all rows sum to exactly 100.0000)
 * or `amount` (all rows sum to design_engagements.design_fee). A schedule never
 * mixes bases — the side-effect validates that in scale-4 BigInt before writing.
 * Cascade delete follows the parent engagement.
 */
export const engagementMilestones = pgTable(
  'engagement_milestones',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    kind: milestoneKind('kind').notNull(),
    basis: milestoneBasis('basis').notNull(),
    value: money('value').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('engagement_milestones_org_id_id_unique').on(t.orgId, t.id),
    unique('engagement_milestones_org_engagement_kind_unique').on(
      t.orgId,
      t.engagementId,
      t.kind,
    ),
    check('engagement_milestones_value_nonneg', sql`value >= 0`),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
  ],
);

export type EngagementMilestone = typeof engagementMilestones.$inferSelect;
export type NewEngagementMilestone = typeof engagementMilestones.$inferInsert;
