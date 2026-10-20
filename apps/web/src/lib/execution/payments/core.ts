// recordContractPaymentCore: the studio records money received against one
// payment request of an execution contract (plan A9, A4.2). Partial payments
// are allowed; a payment past what is still due is refused under the amount
// with that figure (`payment_exceeds_request`); a payment while the client's
// "I paid" claim on the request waits is refused (`claim_pending_for_request`:
// confirming the claim records it, and a second row would count it twice).
//
// LOCK ORDER (plan): request FOR UPDATE, then read what is paid and claimed,
// then insert. The database guard (`trg_contract_payments_fits`) takes the same
// lock again for nothing, and refuses on its own (MT130 / MT131) a writer that
// skipped it; the guard's codes read as this core's (../payment-guard.ts).
//
// IDEMPOTENT: the key is required. A key the contract already recorded answers
// that payment with `already: true` before any other check, so a retry after a
// lost answer is never refused for the money it already counted.
import { paymentRequests, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { requestOutstanding } from '../money/outstanding';
import { appendKeyedContractPayment, findKeyedPayment } from './append';
import { readContractPayment, type TypedContractPayment } from './input';

export interface RecordContractPaymentInput extends TypedContractPayment {
  requestId?: unknown;
  idempotencyKey?: unknown;
}

async function lockRequest(tx: MetraDb, requestId: string) {
  const [row] = await tx
    .select({ contractId: paymentRequests.contractId, status: paymentRequests.status, amount: paymentRequests.amount })
    .from(paymentRequests)
    .where(eq(paymentRequests.id, requestId))
    .limit(1)
    .for('update');
  if (!row) fail('request_not_found');
  return row;
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

export async function recordContractPaymentCore(
  ctx: OrgContext,
  input: RecordContractPaymentInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!isUuid(requestId) || !isUuid(idempotencyKey)) return err('malformed');
  const read = readContractPayment(input, todayInCairo(new Date()));
  if (!read.ok) return fieldsFailed(read.errors);
  const payment = read.values;

  // Set inside the transaction; the assertion keeps TypeScript from narrowing it to false.
  let already = false as boolean;
  const result = await mutateInOrg(ctx, { capability: 'payments', action: 'create' }, async (tx, audit) => {
    const request = await lockRequest(tx, requestId);
    const replayed = await findKeyedPayment(tx, request.contractId, idempotencyKey);
    if (replayed !== null) {
      already = true;
      return replayed;
    }
    if (request.status !== 'issued') fail('request_void');
    const settlement = await settlementOf(tx, requestId);
    if (settlement.pending_claim) fail('claim_pending_for_request');
    const outstanding = requestOutstanding(request.amount, [settlement.paid]);
    if (parseMoney4(payment.amount) > parseMoney4(outstanding)) {
      failFields({ amount: { code: 'payment_exceeds_request', params: { outstanding } } });
    }
    const appended = await appendKeyedContractPayment(
      tx,
      ctx,
      { contractId: request.contractId, requestId, outstanding },
      payment,
      idempotencyKey,
    );
    already = appended.already;
    if (!appended.already) {
      await audit({
        entity: 'contract_payment',
        entityId: appended.id,
        action: 'create',
        before: null,
        after: { request_id: requestId, amount: payment.amount, received_on: payment.receivedOn },
      });
    }
    return appended.id;
  });
  return result.ok ? { ...result, already } : result;
}
