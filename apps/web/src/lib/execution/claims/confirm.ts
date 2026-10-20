// confirmContractClaimCore: the studio confirms a client's "I paid" on a
// payment request (B4.2): the money arrived. ONE transaction records the real
// payment in the contract's ledger AND flips the claim to `confirmed`, so a
// claim is never confirmed without its payment, nor a payment written for a
// claim left pending. The amount is the studio's (the form opens on what the
// client claimed, what was still due then), checked again under the lock.
//
// LOCK ORDER (plan): the claim FOR UPDATE, then the request FOR UPDATE, then
// what is paid is read, then the payment is inserted and the claim flipped
// `where status = 'pending'` (0 rows rolls everything back). A dismiss locks
// the claim first too, so a confirm and a dismiss of one claim end with
// exactly one outcome (AC36). The payment-fits trigger is the backstop: its
// MT130 / MT131 read as this core's `request_void` and the amount refusal
// (../payment-guard.ts).
//
// The payment's idempotency key is `claim:<claim id>`: not a uuid, so the
// studio's own payment form (which requires a uuid key) can never mint a row
// in this namespace and have a confirm adopt it (the design fee's rule).
import { contractPaymentClaims, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { invariant } from '@/lib/actions/invariant';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { requestOutstanding } from '../money/outstanding';
import { appendKeyedContractPayment } from '../payments/append';
import { isSamePayment } from '../payments/replay';
import { lockPaymentRequest } from '../payments/request-lock';
import { readConfirmedAmount } from './input';
import { lockClaim, type LockedClaim } from './queries';

export interface ConfirmContractClaimInput {
  claimId?: unknown;
  /** What arrived, as the studio typed it (pre-filled with the claimed amount). */
  amount?: unknown;
}

/** What is still due on the claim's request, read behind its lock; the refusals of a confirm that cannot land. */
async function dueOnRequest(tx: MetraDb, claim: LockedClaim, amount: string) {
  const request = await lockPaymentRequest(tx, claim.requestId);
  if (request.status !== 'issued') fail('request_void');
  const [row] = (await tx.execute(sql`
    select coalesce(sum(p.amount), 0)::text as paid from public.contract_payments p where p.request_id = ${claim.requestId}
  `)) as unknown as Array<{ paid: string }>;
  const outstanding = requestOutstanding(request.amount, [row.paid]);
  // Paid in full meanwhile (recorded by hand before the claim): confirming would count it twice.
  if (parseMoney4(outstanding) <= 0n) fail('claim_already_settled');
  if (parseMoney4(amount) > parseMoney4(outstanding)) {
    failFields({ amount: { code: 'payment_exceeds_request', params: { outstanding } } });
  }
  return outstanding;
}

export async function confirmContractClaimCore(
  ctx: OrgContext,
  input: ConfirmContractClaimInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const claimId = typeof input.claimId === 'string' ? input.claimId.trim() : '';
  if (!isUuid(claimId)) return err('malformed');
  const typed = readConfirmedAmount(input.amount);
  if (!typed.ok) return fieldsFailed({ amount: typed.error });
  const amount = typed.value;

  // Set inside the transaction; the assertion keeps TypeScript from narrowing it to false.
  let already = false as boolean;
  const result = await mutateInOrg(ctx, { capability: 'payments', action: 'create' }, async (tx, audit) => {
    const claim = await lockClaim(tx, claimId);
    if (claim.status === 'confirmed') {
      invariant(claim.confirmedPaymentId, 'a confirmed claim without its payment');
      already = true;
      return claim.confirmedPaymentId;
    }
    if (claim.status !== 'pending') fail('claim_not_found');
    const outstanding = await dueOnRequest(tx, claim, amount);
    const payment = { amount, receivedOn: todayInCairo(new Date()), method: null, reference: null, note: null };
    const target = { contractId: claim.contractId, requestId: claim.requestId, outstanding };
    const appended = await appendKeyedContractPayment(tx, ctx, target, payment, `claim:${claim.id}`);
    // A row under this claim's key while the claim is still pending is not this
    // confirm's: adopting a different payment would resolve the claim against it.
    if ('replayed' in appended) {
      invariant(isSamePayment(appended.replayed, { requestId: claim.requestId, amount }), 'claim payment differs');
      already = true;
    }
    const paymentId = 'inserted' in appended ? appended.inserted : appended.replayed.id;
    const flipped = await tx
      .update(contractPaymentClaims)
      .set({ status: 'confirmed', confirmedPaymentId: paymentId, resolvedBy: ctx.userId, resolvedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(contractPaymentClaims.id, claim.id), eq(contractPaymentClaims.status, 'pending')))
      .returning({ id: contractPaymentClaims.id });
    if (flipped.length === 0) fail('claim_not_found');
    await audit({
      entity: 'contract_payment_claim',
      entityId: claim.id,
      action: 'update',
      before: { status: 'pending' },
      after: { status: 'confirmed', payment_id: paymentId, amount },
    });
    return paymentId;
  });
  return result.ok ? { ...result, already } : result;
}
