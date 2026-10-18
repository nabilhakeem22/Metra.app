import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money } from './_helpers';
import { contractPaymentMilestones } from './contract-payment-milestones';
import { contracts } from './contracts';
import { paymentRequestKind, paymentRequestStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { variationOrders } from './variation-orders';

/**
 * A payment request (مطالبة دفع, owner decision D3a) against an execution
 * contract (Stage 2, 0063): a FROZEN document. `number` is a per-org int
 * sequence rendered `PR-YYYY-NNNN`, never reused (a void keeps its number).
 *
 * It bills exactly one thing, by `kind`: one schedule milestone, one approved
 * change order, or the final account (`payment_requests_kind_target`). At most
 * one LIVE (`issued`) request per milestone, per change order and per contract's
 * final account (three partial uniques); voiding one frees its slot.
 *
 * `amount` includes VAT; `tax_amount` is the VAT share of it. What has been PAID
 * is never stored here: it is the sum of `contract_payments` against the row.
 *
 * IMMUTABLE once written, by `trg_payment_requests_frozen`
 * (`enforce_payment_request_frozen()`, rls/functions/35-execution.sql): DELETE
 * raises MT100, and the only UPDATE is `issued -> void` touching nothing but
 * `status`, `voided_at`, `voided_by` and `updated_at`. roles.sql grants no
 * DELETE either.
 */
export const paymentRequests = pgTable(
  'payment_requests',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').notNull(),
    number: integer('number').notNull(),
    kind: paymentRequestKind('kind').notNull(),
    milestoneId: uuid('milestone_id'),
    variationOrderId: uuid('variation_order_id'),
    amount: money('amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    issuedOn: date('issued_on').notNull(),
    dueOn: date('due_on'),
    status: paymentRequestStatus('status').notNull().default('issued'),
    note: text('note'),
    issuedBy: uuid('issued_by').notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
  },
  (t) => [
    unique('payment_requests_org_id_id_unique').on(t.orgId, t.id),
    unique('payment_requests_org_id_number_unique').on(t.orgId, t.number),
    // The target of the 3-column FKs from payments and claims: a payment can only
    // be recorded against a request of ITS OWN contract.
    unique('payment_requests_org_contract_id_unique').on(t.orgId, t.contractId, t.id),
    check('payment_requests_amount_positive', sql`amount > 0`),
    check('payment_requests_tax_amount_range', sql`tax_amount >= 0 and tax_amount <= amount`),
    check('payment_requests_due_after_issue', sql`due_on >= issued_on`),
    check('payment_requests_note_length', sql`char_length(note) <= 500`),
    // CASE over kind::text, so a kind appended to the enum later must name
    // neither target until this CHECK learns it, rather than being admitted
    // with a stray one.
    check(
      'payment_requests_kind_target',
      sql`case kind::text
      when 'milestone' then milestone_id is not null and variation_order_id is null
      when 'variation' then variation_order_id is not null and milestone_id is null
      else milestone_id is null and variation_order_id is null end`,
    ),
    check(
      'payment_requests_void_pair',
      sql`(status = 'void') = (voided_at is not null) and (voided_at is null) = (voided_by is null)`,
    ),
    // `index: false` on the contract FK: the request list index below leads with
    // the same two columns.
    ...sameOrgFk(t, 'contract', contracts, { onDelete: 'restrict', index: false }),
    ...sameOrgFk(t, 'milestone', contractPaymentMilestones, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'variationOrder', variationOrders, { onDelete: 'restrict' }),
    // The contract's request list, newest first.
    index('payment_requests_org_contract_issued_idx').on(
      t.orgId,
      t.contractId,
      t.issuedOn.desc(),
      t.id.desc(),
    ),
    uniqueIndex('payment_requests_one_per_milestone')
      .on(t.orgId, t.milestoneId)
      .where(sql`status = 'issued' and milestone_id is not null`),
    uniqueIndex('payment_requests_one_per_variation')
      .on(t.orgId, t.variationOrderId)
      .where(sql`status = 'issued' and variation_order_id is not null`),
    uniqueIndex('payment_requests_one_final_account')
      .on(t.orgId, t.contractId)
      .where(sql`status = 'issued' and kind = 'final_account'`),
  ],
);

export type PaymentRequest = typeof paymentRequests.$inferSelect;
export type NewPaymentRequest = typeof paymentRequests.$inferInsert;
