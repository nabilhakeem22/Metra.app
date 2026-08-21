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
import { paymentEventKind } from './enums';
import { money } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Append-only payment ledger (Design-Engagement Machine, Step 4). Grant model:
 * INSERT + SELECT only (no UPDATE/DELETE) — mirrors contract_events. In the
 * manual finance model there is NO gateway: a RECORDED payment IS a CLEARED
 * payment, so `cleared_at` defaults to now(). The `depositCleared` guard sums
 * the `deposit` rows here against the deposit milestone to admit
 * `confirmAndPayDeposit`. `amount` is scale-4 money with a DB CHECK > 0; `method`
 * / `reference` / `note` are free-text (bank_transfer / cash / cheque, etc.).
 * Cascade delete follows the parent engagement.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    kind: paymentEventKind('kind').notNull(),
    amount: money('amount').notNull(),
    // Free-text payment method (e.g. bank_transfer / cash / cheque); nullable.
    method: text('method'),
    // Free-text external reference (transfer id, cheque number, …); nullable.
    reference: text('reference'),
    // A recorded payment is a CLEARED payment in the manual model.
    clearedAt: timestamp('cleared_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedBy: uuid('recorded_by').notNull(),
    note: text('note'),
  },
  (t) => [
    unique('payment_events_org_id_id_unique').on(t.orgId, t.id),
    check('payment_events_amount_positive', sql`amount > 0`),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
    index('payment_events_org_engagement_kind_idx').on(
      t.orgId,
      t.engagementId,
      t.kind,
    ),
  ],
);

export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type NewPaymentEvent = typeof paymentEvents.$inferInsert;
