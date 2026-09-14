import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
    /**
     * The caller's name for ONE ATTEMPT at a self-loop transition (0050).
     *
     * A self-loop has no admission gate: an advancing edge is protected by its
     * own from-state, so a second attempt finds the engagement already moved and
     * does nothing, but a self-loop leaves the state exactly where it was and
     * every retry is a fresh, valid request. This column lets the server tell a
     * retry of ONE act — a request that committed and whose response was lost on
     * the way back — from a genuine second act, so one tap cannot burn two free
     * revisions. Scoped to the TRIGGER as well as the engagement: the same key on
     * a different verb is a different act. NULL on every advancing edge and on
     * every pre-0050 row.
     */
    idempotencyKey: text('idempotency_key'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('engagement_transitions_org_id_id_unique').on(t.orgId, t.id),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
    // Live since 0050 — one ledger row per (org, engagement, TRIGGER, key). The
    // trigger is part of the key's identity: a key names one attempt at one act,
    // so reusing it on a different verb must write a second row rather than be
    // swallowed as a replay of the first. PARTIAL on IS NOT NULL: NULLs never
    // collide in a unique index anyway, and stating it keeps the index to the
    // rows that actually carry a key.
    uniqueIndex('engagement_transitions_idempotency_key_uniq')
      .on(t.orgId, t.engagementId, t.trigger, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ],
);

export type EngagementTransition = typeof engagementTransitions.$inferSelect;
export type NewEngagementTransition = typeof engagementTransitions.$inferInsert;
