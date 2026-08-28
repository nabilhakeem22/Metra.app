import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { designEngagements } from './design-engagements';
import { clientPaymentClaimStatus, milestoneKind } from './enums';
import { money } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { paymentEvents } from './payment-events';
import { sameOrgFk } from './org-ref';

/**
 * Client Delivery Portal, Phase 3 — client-submitted payment claims.
 *
 * A session-less end-client "mark as paid" on the delivery portal APPENDS one
 * `pending` row here (via the cost-blind SECURITY DEFINER SDF
 * `app_delivery_claim_payment_by_token`). The client NEVER moves state and NEVER
 * writes the real money ledger — `claimed_amount` is computed server-side (locked
 * to the milestone's full remaining due). The STUDIO later resolves the claim from
 * the cockpit: `confirmed` (the studio recorded the real payment via
 * recordPaymentCore and stamped `confirmed_payment_event_id`) or `dismissed` (no
 * ledger row). The firm is NEVER blocked/gated by a claim.
 *
 * IMMUTABILITY EXCEPTION: unlike the append-only ledgers (payment_events,
 * engagement_events, …) this table has a MUTABLE status lifecycle — the studio
 * confirm/dismiss UPDATES `status` + the resolution columns. It is therefore
 * DELIBERATELY NOT registered in rls/immutability.sql, and roles.sql grants
 * SELECT + INSERT + UPDATE (not the append-only SELECT + INSERT).
 *
 * A PARTIAL UNIQUE index enforces at most ONE open (`pending`) claim per
 * (engagement, milestone_kind): a resolved (confirmed/dismissed) claim frees the
 * slot so the client may re-submit if the studio dismissed it. Cascade delete
 * follows the parent engagement; `confirmed_payment_event_id` is set null if its
 * payment row is ever removed (defensive — the ledger is append-only).
 */
export const clientPaymentClaims = pgTable(
  'client_payment_claims',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    milestoneKind: milestoneKind('milestone_kind').notNull(),
    // Locked to the milestone's full remaining due, computed server-side (the
    // client never sends an amount). Scale-4 money with a DB CHECK > 0.
    claimedAmount: money('claimed_amount').notNull(),
    note: text('note'),
    // The session-less client's provenance (name they optionally entered + IP/UA).
    actorName: text('actor_name'),
    actorIp: text('actor_ip'),
    actorUserAgent: text('actor_user_agent'),
    status: clientPaymentClaimStatus('status').notNull().default('pending'),
    // Set on confirm: the payment_events row the studio recorded (nullable
    // sameOrgFk, set null if that ledger row is ever removed).
    confirmedPaymentEventId: uuid('confirmed_payment_event_id'),
    // Who/when the studio resolved the claim (confirm or dismiss). Null while pending.
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    unique('client_payment_claims_org_id_id_unique').on(t.orgId, t.id),
    check('client_payment_claims_amount_positive', sql`claimed_amount > 0`),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'confirmedPaymentEvent', paymentEvents, {
      onDelete: 'set null',
    }),
    index('client_payment_claims_org_engagement_status_idx').on(
      t.orgId,
      t.engagementId,
      t.status,
    ),
    // At most one OPEN claim per milestone (a resolved claim frees the slot).
    uniqueIndex('client_payment_claims_pending_milestone_unique')
      .on(t.engagementId, t.milestoneKind)
      .where(sql`status = 'pending'`),
  ],
);

export type ClientPaymentClaim = typeof clientPaymentClaims.$inferSelect;
export type NewClientPaymentClaim = typeof clientPaymentClaims.$inferInsert;
