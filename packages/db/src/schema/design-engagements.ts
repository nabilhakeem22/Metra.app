import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { clients } from './clients';
import { designEngagementState } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projects } from './projects';

/**
 * Design engagements (Design-Engagement Machine, Step 1). The greenfield
 * engagement domain for the interior-design pivot: one record per client design
 * job, created in state `created`. `number` is a per-org int sequence rendered
 * `DE-YYYY-NNNN`. The lifecycle state machine (transitions / guards / executor)
 * is Step 2 — this slice only ever writes rows in `created`.
 *
 * `romLow`/`romHigh` are the rough-order-of-magnitude budget band (nullable;
 * CHECK: high >= low when both present). `freeRevisionN` (default 3) is the free
 * revision allowance; `revisionCount` tracks consumption. `tokenHash` is the
 * sha256 of a future client share token (Step 2+), unique when set.
 */
export const designEngagements = pgTable(
  'design_engagements',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    ...bilingual('title'),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull(),
    state: designEngagementState('state').notNull().default('created'),
    // Set when `submitDesignFee` fires (Step 3): the agreed design fee whose
    // milestone schedule lives in engagement_milestones. Nullable until then.
    designFee: money('design_fee'),
    offPlan: boolean('off_plan').notNull().default(false),
    asBuiltDue: boolean('as_built_due').notNull().default(false),
    freeRevisionN: integer('free_revision_n').notNull().default(3),
    revisionCount: integer('revision_count').notNull().default(0),
    romLow: money('rom_low'),
    romHigh: money('rom_high'),
    conceptLockedAt: timestamp('concept_locked_at', { withTimezone: true }),
    tokenHash: text('token_hash'),
    shareExpiresAt: timestamp('share_expires_at', { withTimezone: true }),
  },
  (t) => [
    unique('design_engagements_org_id_id_unique').on(t.orgId, t.id),
    unique('design_engagements_org_id_number_unique').on(t.orgId, t.number),
    unique('design_engagements_token_hash_unique').on(t.tokenHash),
    bilingualCheck('design_engagements', 'title'),
    check(
      'design_engagements_rom_range',
      sql`rom_high is null or rom_low is null or rom_high >= rom_low`,
    ),
    ...sameOrgFk(t, 'client', clients, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'project', projects, { onDelete: 'restrict' }),
    index('design_engagements_org_state_idx').on(t.orgId, t.state),
    index('design_engagements_org_project_idx').on(t.orgId, t.projectId),
  ],
);

export type DesignEngagement = typeof designEngagements.$inferSelect;
export type NewDesignEngagement = typeof designEngagements.$inferInsert;
