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
import { money } from './_helpers';
import { contractPayments } from './contract-payments';
import { clientPaymentClaimStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameContractFk, sameOrgFk } from './org-ref';
import { paymentRequests } from './payment-requests';

/**
 * A client's "I paid" against one payment request of an execution contract
 * (Stage 2, 0063), the mirror of `client_payment_claims` for the design fee.
 *
 * The client APPENDS a `pending` row through a token SDF (DB step B, /d) with
 * `claimed_amount` computed server-side as the request's outstanding balance;
 * the client never sends an amount and never writes the ledger. The studio then
 * resolves it: `confirmed` (the confirm core inserts the real
 * `contract_payments` row in the same transaction and stamps
 * `confirmed_payment_id`) or `dismissed` (no ledger row).
 *
 * MUTABLE LIFECYCLE, like its design-fee twin: SELECT + INSERT + UPDATE in
 * roles.sql, no DELETE, not in the immutability registry. At most ONE pending
 * claim per request (partial unique); a resolved claim frees the slot.
 * `confirmed_payment_id` is `ON DELETE SET NULL (confirmed_payment_id)` in the
 * database (0063, the 0052 rule), defensive only: the ledger is append-only.
 */
export const contractPaymentClaims = pgTable(
  'contract_payment_claims',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').notNull(),
    requestId: uuid('request_id').notNull(),
    claimedAmount: money('claimed_amount').notNull(),
    note: text('note'),
    actorName: text('actor_name'),
    actorIp: text('actor_ip'),
    actorUserAgent: text('actor_user_agent'),
    status: clientPaymentClaimStatus('status').notNull().default('pending'),
    confirmedPaymentId: uuid('confirmed_payment_id'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    unique('contract_payment_claims_org_id_id_unique').on(t.orgId, t.id),
    check('contract_payment_claims_amount_positive', sql`claimed_amount > 0`),
    // The 0047 rule of `client_payment_claims`, word for word: CASE over
    // status::text, and a dismissal carries who refused it and NO payment.
    check(
      'contract_payment_claims_resolution',
      sql`case status::text
      when 'pending'   then resolved_at is null and resolved_by is null and confirmed_payment_id is null
      when 'dismissed' then resolved_at is not null and resolved_by is not null and confirmed_payment_id is null
      when 'confirmed' then resolved_at is not null and confirmed_payment_id is not null
      else true end`,
    ),
    sameContractFk(t, 'request', paymentRequests),
    ...sameOrgFk(t, 'confirmedPayment', contractPayments, { onDelete: 'set null' }),
    index('contract_payment_claims_org_contract_status_idx').on(
      t.orgId,
      t.contractId,
      t.status,
    ),
    uniqueIndex('contract_payment_claims_pending_request_unique')
      .on(t.requestId)
      .where(sql`status = 'pending'`),
  ],
);

export type ContractPaymentClaim = typeof contractPaymentClaims.$inferSelect;
export type NewContractPaymentClaim = typeof contractPaymentClaims.$inferInsert;
