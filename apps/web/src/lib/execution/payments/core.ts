// recordContractPaymentCore: the studio records money received against one
// payment request of an execution contract (plan A9, A4.2). Partial payments
// are allowed; a payment past what is still due is refused under the amount
// with that figure (`payment_exceeds_request`), and one dated before the
// contract was issued under the day (`date_before_issue`); a payment while the
// client's "I paid" claim on the request waits is refused
// (`claim_pending_for_request`: confirming the claim records it, and a second
// row would count it twice).
//
// LOCK ORDER (plan): request FOR UPDATE, then read what is paid and claimed,
// then insert. The database guard (`trg_contract_payments_fits`) takes the same
// lock again for nothing, and refuses on its own (MT130 / MT131) a writer that
// skipped it; the guard's codes read as this core's (../payment-guard.ts).
//
// IDEMPOTENT: the key is required, and lower-cased. A void request takes
// nothing, a replay included (`request_void`: a paid request cannot be voided,
// so no key of its own can be on it). Then a key the contract already holds is
// judged BEFORE what is due (./replay.ts): the same request and amount answer
// that payment with `already: true`, so a retry after a lost answer is never
// refused for the money it already counted; anything else is
// `idempotency_conflict`, never `already`.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { failFields, fieldsFailed, hasFieldErrors, type FieldError } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { todayInCairo } from '@/lib/automation/clock';
import { contractIssuedOnInCairo } from '@/lib/contracts/queries/issued-on';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { requestOutstanding } from '../money/outstanding';
import { appendKeyedContractPayment, findKeyedPayment } from './append';
import { readContractPayment, receivedBeforeIssue, type CleanContractPayment, type TypedContractPayment } from './input';
import { canonicalIdempotencyKey, isSamePayment, type KeyedPayment } from './replay';
import { lockPaymentRequest, type LockedRequest } from './request-lock';

export interface RecordContractPaymentInput extends TypedContractPayment {
  requestId?: unknown;
  idempotencyKey?: unknown;
}

/** Paid so far and whether a claim waits, read after the lock (RLS scopes both tables). */
async function settlementOf(tx: MetraDb, requestId: string) {
  const rows = (await tx.execute(sql`
    select coalesce((select sum(p.amount) from public.contract_payments p where p.request_id = ${requestId}), 0)::text as paid,
           exists (select 1 from public.contract_payment_claims c
                    where c.request_id = ${requestId} and c.status = 'pending') as pending_claim
  `)) as unknown as Array<{ paid: string; pending_claim: boolean }>;
  return rows[0];
}

/** What is still due once nothing stands in the way of this payment; every refusal of its boxes at once. */
async function outstandingFor(tx: MetraDb, request: LockedRequest, requestId: string, payment: CleanContractPayment) {
  const settlement = await settlementOf(tx, requestId);
  if (settlement.pending_claim) fail('claim_pending_for_request');
  const outstanding = requestOutstanding(request.amount, [settlement.paid]);
  const refused: { amount?: FieldError; receivedOn?: FieldError } = {};
  if (parseMoney4(payment.amount) > parseMoney4(outstanding)) {
    refused.amount = { code: 'payment_exceeds_request', params: { outstanding } };
  }
  const beforeIssue = receivedBeforeIssue(payment.receivedOn, await contractIssuedOnInCairo(tx, request.contractId));
  if (beforeIssue) refused.receivedOn = beforeIssue;
  if (hasFieldErrors(refused)) failFields(refused);
  return outstanding;
}

/** The stored row's id when it IS this payment; a different payment under the key is refused. */
function replayedPayment(stored: KeyedPayment, attempt: { requestId: string; amount: string }): string {
  if (!isSamePayment(stored, attempt)) fail('idempotency_conflict');
  return stored.id;
}

export async function recordContractPaymentCore(
  ctx: OrgContext,
  input: RecordContractPaymentInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  const idempotencyKey = canonicalIdempotencyKey(input.idempotencyKey);
  if (!isUuid(requestId) || !isUuid(idempotencyKey)) return err('malformed');
  const read = readContractPayment(input, todayInCairo(new Date()));
  if (!read.ok) return fieldsFailed(read.errors);
  const payment = read.values;
  const attempt = { requestId, amount: payment.amount };

  // Set inside the transaction; the assertion keeps TypeScript from narrowing it to false.
  let already = false as boolean;
  const result = await mutateInOrg(ctx, { capability: 'payments', action: 'create' }, async (tx, audit) => {
    const request = await lockPaymentRequest(tx, requestId);
    if (request.status !== 'issued') fail('request_void');
    const stored = await findKeyedPayment(tx, request.contractId, idempotencyKey);
    if (stored !== null) {
      already = true;
      return replayedPayment(stored, attempt);
    }
    const outstanding = await outstandingFor(tx, request, requestId, payment);
    const target = { contractId: request.contractId, requestId, outstanding };
    const appended = await appendKeyedContractPayment(tx, ctx, target, payment, idempotencyKey);
    if ('replayed' in appended) {
      already = true;
      return replayedPayment(appended.replayed, attempt);
    }
    await audit({
      entity: 'contract_payment',
      entityId: appended.inserted,
      action: 'create',
      before: null,
      after: { request_id: requestId, amount: payment.amount, received_on: payment.receivedOn },
    });
    return appended.inserted;
  });
  return result.ok ? { ...result, already } : result;
}
