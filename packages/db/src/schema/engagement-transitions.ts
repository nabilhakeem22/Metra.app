import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { designEngagements } from './design-engagements';
import { designEngagementState } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Append-only design-engagement lifecycle ledger (grant model: INSERT + SELECT
 * only, no UPDATE/DELETE). Records every state transition — the trigger that
 * fired, the from/to state, the acting user and an optional note.
 *
 * Step 1 writes NO rows here: the table exists so the transition executor (Step
 * 2) has its ledger + isolation coverage in place from the start.
 */
export const engagementTransitions = pgTable(
  'engagement_transitions',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    trigger: text('trigger'),
    fromState: designEngagementState('from_state'),
    toState: designEngagementState('to_state'),
    actorUserId: uuid('actor_user_id'),
    note: text('note'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('engagement_transitions_org_id_id_unique').on(t.orgId, t.id),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
  ],
);

export type EngagementTransition = typeof engagementTransitions.$inferSelect;
export type NewEngagementTransition = typeof engagementTransitions.$inferInsert;
