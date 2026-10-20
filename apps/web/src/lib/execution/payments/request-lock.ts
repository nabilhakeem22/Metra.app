import 'server-only';
// The payment request row FOR UPDATE: the first statement of every writer of
// the payment ledger (plan lock order: claim, then request), and of the check
// that asks whether an earlier attempt landed (check-attempt.ts). Holding it
// means every other writer of that request has finished or not started.
import { paymentRequests, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';

export interface LockedRequest {
  contractId: string;
  status: string;
  amount: string;
}

export async function lockPaymentRequest(tx: MetraDb, requestId: string): Promise<LockedRequest> {
  const [row] = await tx
    .select({ contractId: paymentRequests.contractId, status: paymentRequests.status, amount: paymentRequests.amount })
    .from(paymentRequests)
    .where(eq(paymentRequests.id, requestId))
    .limit(1)
    .for('update');
  if (!row) fail('request_not_found');
  return row;
}
