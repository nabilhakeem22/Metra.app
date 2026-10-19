import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameContractFk } from './org-ref';
import { paymentRequests } from './payment-requests';

/**
 * The execution contract's append-only payment ledger (Stage 2, 0063). Every row
 * is money received against ONE payment request of the same contract (the
 * 3-column FK). Partial payments are allowed; over-payment is refused by the core
 * under the request's row lock (lib/execution/payments).
 *
 * APPEND-ONLY BY GRANT: roles.sql gives metra_app SELECT + INSERT only, so an
 * UPDATE or DELETE is a permission error at the database (the immutability
 * decision matrix: a ledger uses grants, a status-locked document uses a
 * trigger).
 *
 * `idempotency_key` (optional, client-supplied) dedups a retried recording per
 * contract through the partial unique below (ON CONFLICT DO NOTHING).
 */
export const contractPayments = pgTable(
  'contract_payments',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').notNull(),
    requestId: uuid('request_id').notNull(),
    amount: money('amount').notNull(),
    method: text('method'),
    reference: text('reference'),
    receivedOn: date('received_on').notNull(),
    recordedBy: uuid('recorded_by').notNull(),
    note: text('note'),
    idempotencyKey: text('idempotency_key'),
  },
  (t) => [
    unique('contract_payments_org_id_id_unique').on(t.orgId, t.id),
    check('contract_payments_amount_positive', sql`amount > 0 and amount <> 'NaN'`),
    check(
      'contract_payments_text_length',
      sql`char_length(method) <= 40 and char_length(reference) <= 120 and char_length(note) <= 500`,
    ),
    sameContractFk(t, 'request', paymentRequests),
    index('contract_payments_org_request_idx').on(t.orgId, t.requestId),
    index('contract_payments_org_contract_received_idx').on(
      t.orgId,
      t.contractId,
      t.receivedOn.desc(),
      t.id.desc(),
    ),
    uniqueIndex('contract_payments_idempotency_key_uniq')
      .on(t.orgId, t.contractId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ],
);

export type ContractPayment = typeof contractPayments.$inferSelect;
export type NewContractPayment = typeof contractPayments.$inferInsert;
