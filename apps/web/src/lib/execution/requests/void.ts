// voidPaymentRequestCore: the studio withdraws a mistaken payment request
// (plan A10). Only an unpaid request with no pending client claim; a milestone
// or change-order request not while the final account is issued (the final
// account billed up to it; void the final account first, A4.1 addendum). The
// void frees its milestone or change order to be requested again under a NEW
// number; the voided request keeps its own.
//
// The row is frozen (`enforce_payment_request_frozen`): the one UPDATE it
// admits is `issued -> void` writing EXACTLY status, voided_at, voided_by and
// updated_at, so the reason goes to the audit log, never to the row. A void
// that meets a payment the core did not see is MT132 from that trigger, said
// as `request_has_payments`.
//
// LOCKS: the contract, then the request (billing-lock.ts); pending claims are
// READ, never locked, so this cannot deadlock against a claim confirm (claim,
// then request).
import { paymentRequests, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { underPaymentGuard } from '../payment-guard';
import { lockExecutionContract } from './billing-lock';
import { readVoidReason } from './input';

export interface VoidPaymentRequestInput {
  requestId?: unknown;
  reason?: unknown;
}

async function lockRequest(tx: MetraDb, requestId: string) {
  const [row] = await tx
    .select({ status: paymentRequests.status, kind: paymentRequests.kind, amount: paymentRequests.amount })
    .from(paymentRequests)
    .where(eq(paymentRequests.id, requestId))
    .limit(1)
    .for('update');
  if (!row) fail('request_not_found');
  return row;
}

/** What stands in the way of a void, in one statement (RLS scopes each table to the org). */
async function voidBlockers(tx: MetraDb, contractId: string, requestId: string) {
  const rows = (await tx.execute(sql`
    select
      exists (select 1 from public.payment_requests f
               where f.contract_id = ${contractId} and f.kind = 'final_account' and f.status = 'issued') as final_account,
      exists (select 1 from public.contract_payment_claims c
               where c.request_id = ${requestId} and c.status = 'pending') as pending_claim,
      exists (select 1 from public.contract_payments p where p.request_id = ${requestId}) as paid
  `)) as unknown as Array<{ final_account: boolean; pending_claim: boolean; paid: boolean }>;
  return rows[0];
}

export async function voidPaymentRequestCore(ctx: OrgContext, input: VoidPaymentRequestInput): Promise<ActionResult> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  if (!isUuid(requestId)) return err('malformed');
  const read = readVoidReason(input);
  if (!read.ok) return fieldsFailed(read.errors);

  return mutateInOrg(
    ctx,
    { capability: 'invoices_issue', action: 'approve', immutableCode: 'request_void' },
    async (tx, audit) => {
      const located = await requireInOrg(
        tx,
        paymentRequests,
        requestId,
        { contractId: paymentRequests.contractId },
        'request_not_found',
      );
      await lockExecutionContract(tx, located.contractId);
      const request = await lockRequest(tx, requestId);
      if (request.status !== 'issued') fail('request_void');
      const blockers = await voidBlockers(tx, located.contractId, requestId);
      if (request.kind !== 'final_account' && blockers.final_account) fail('final_account_issued');
      if (blockers.pending_claim) fail('claim_pending_for_request');
      if (blockers.paid) fail('request_has_payments');
      const voided = await underPaymentGuard(
        tx
          .update(paymentRequests)
          .set({ status: 'void', voidedAt: sql`now()`, voidedBy: ctx.userId, updatedAt: sql`now()` })
          .where(and(eq(paymentRequests.id, requestId), eq(paymentRequests.status, 'issued')))
          .returning({ id: paymentRequests.id }),
        request.amount,
      );
      if (!voided[0]) fail('request_void');
      await audit({
        entity: 'payment_request',
        entityId: requestId,
        action: 'update',
        before: { status: 'issued' },
        after: { status: 'void', reason: read.values.reason },
      });
    },
  );
}
