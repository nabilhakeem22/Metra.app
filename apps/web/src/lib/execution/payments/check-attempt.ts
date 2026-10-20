// checkPaymentAttemptCore: did an earlier attempt to record a payment, whose
// answer was lost, land in the ledger? The record dialog asks it before it lets
// the studio record a DIFFERENT payment on the same request (A4 N1).
//
// A plain read could not answer it. The first attempt may still be running,
// waiting on the request's row lock (a void, another payment, a slow commit):
// a read then sees nothing, the dialog released the key, the first attempt
// committed a moment later, and the different payment was recorded beside it.
// So this takes the request row FOR UPDATE first, in a short transaction of its
// own, and only then looks for the key: it queues behind any writer of that
// request that is running, and reads what that writer committed. The wait is
// bounded by the app's lock_timeout (5 s); a check that times out is
// `uncertain`, and the dialog keeps the key.
//
// It writes nothing and audits nothing; it is gated as the act it guards
// (`payments` create), because only a role that records payments holds a key.
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { findKeyedPayment } from './append';
import { canonicalIdempotencyKey } from './replay';
import { lockPaymentRequest } from './request-lock';

export interface CheckPaymentAttemptInput {
  requestId?: unknown;
  idempotencyKey?: unknown;
}

/** `landed`: the ledger holds a payment under this key, committed by now. */
export async function checkPaymentAttemptCore(
  ctx: OrgContext,
  input: CheckPaymentAttemptInput,
): Promise<ActionResult & { data?: { landed: boolean } }> {
  if (!isRecord(input)) return err('malformed');
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  const idempotencyKey = canonicalIdempotencyKey(input.idempotencyKey);
  if (!isUuid(requestId) || !isUuid(idempotencyKey)) return err('malformed');

  return mutateInOrg(ctx, { capability: 'payments', action: 'create' }, async (tx) => {
    const request = await lockPaymentRequest(tx, requestId);
    return { landed: (await findKeyedPayment(tx, request.contractId, idempotencyKey)) !== null };
  });
}
