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
import { designEngagements } from './design-engagements';
import { changeOrderStatus } from './enums';
import { money } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { paymentEvents } from './payment-events';

/**
 * Engagement change orders (Design-Engagement Machine, Step 8). One row per
 * design-fee change order raised when a `requestRevision` self-loop crosses the
 * free-revision allowance (`revision_count > free_revision_n`). A raised change
 * order carries the extra fee `amount` (scale-4 money, DB CHECK > 0) and an
 * optional `reason`. NOT append-only: `status` goes `raised` -> `settled` once
 * the matching revision_co payment is recorded — but that settle path is Step 9;
 * this step only INSERTs `raised` rows (UPDATE is reserved/granted for Step 9).
 * Cascade delete follows the parent engagement.
 */
export const engagementChangeOrders = pgTable(
  'engagement_change_orders',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    amount: money('amount').notNull(),
    // Optional free-text reason for the change order.
    reason: text('reason'),
    status: changeOrderStatus('status').notNull().default('raised'),
    raisedByUserId: uuid('raised_by_user_id').notNull(),
    raisedAt: timestamp('raised_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set when the change order is settled (Step 9); nullable while raised.
    settledAt: timestamp('settled_at', { withTimezone: true }),
    // WHICH payment settled it: the revision_co payment event whose credit
    // completed this change order's cover. Nullable, and NULL on change orders
    // settled before 0046 added the link (that mapping was amount-based and is
    // not recoverable), so `settled` does NOT imply a link.
    // Declared explicitly rather than via sameOrgRef: that helper derives the
    // column name verbatim from the ref name, which would emit
    // "settledByPaymentEvent_id" for a multi-word ref. sameOrgFk still keys off
    // the `settledByPaymentEventId` property, so the composite FK and its index
    // are named exactly as migration 0046 creates them.
    settledByPaymentEventId: uuid('settled_by_payment_event_id'),
  },
  (t) => [
    unique('engagement_change_orders_org_id_id_unique').on(t.orgId, t.id),
    check('engagement_change_orders_amount_positive', sql`amount > 0`),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'settledByPaymentEvent', paymentEvents, {
      onDelete: 'set null',
    }),
    index('engagement_change_orders_org_engagement_status_idx').on(
      t.orgId,
      t.engagementId,
      t.status,
    ),
  ],
);

export type EngagementChangeOrder = typeof engagementChangeOrders.$inferSelect;
export type NewEngagementChangeOrder =
  typeof engagementChangeOrders.$inferInsert;
