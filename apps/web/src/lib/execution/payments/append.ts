import 'server-only';
// The one way a row reaches the execution contract's append-only payment
// ledger, keyed. Nothing here decides anything: the core has locked the
// request and refused what does not fit, and it judges a replayed key
// (./replay.ts). The caller's `tx` is used and nothing else. Mirrors the
// design fee's appendKeyedPayment (lib/engagements/payment-append.ts): ON
// CONFLICT DO NOTHING on the partial arbiter, so a replay never aborts the
// transaction and never writes a second row; the row that holds the key comes
// back for the core to judge.
import { contractPayments, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { underPaymentGuard } from '../payment-guard';
import type { CleanContractPayment } from './input';
import type { KeyedPayment } from './replay';

export interface LedgerTarget {
  contractId: string;
  requestId: string;
  /** What the core read as still due: said under the amount if the guard refuses. */
  outstanding: string;
}

/** The payment this key already recorded on the contract, or null. */
export async function findKeyedPayment(
  tx: MetraDb,
  contractId: string,
  idempotencyKey: string,
): Promise<KeyedPayment | null> {
  const [row] = await tx
    .select({ id: contractPayments.id, requestId: contractPayments.requestId, amount: contractPayments.amount })
    .from(contractPayments)
    .where(and(eq(contractPayments.contractId, contractId), eq(contractPayments.idempotencyKey, idempotencyKey)))
    .limit(1);
  return row ?? null;
}

/** The new row's id, or the row a concurrent write of the same key committed first. */
export async function appendKeyedContractPayment(
  tx: MetraDb,
  ctx: OrgContext,
  target: LedgerTarget,
  payment: CleanContractPayment,
  idempotencyKey: string,
): Promise<{ inserted: string } | { replayed: KeyedPayment }> {
  const inserted = await underPaymentGuard(
    tx
      .insert(contractPayments)
      .values({
        orgId: ctx.orgId,
        contractId: target.contractId,
        requestId: target.requestId,
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        receivedOn: payment.receivedOn,
        note: payment.note,
        recordedBy: ctx.userId,
        idempotencyKey,
      })
      .onConflictDoNothing({
        // The arbiter predicate: renders `ON CONFLICT (org_id, contract_id,
        // idempotency_key) WHERE idempotency_key is not null DO NOTHING`, the
        // partial unique `contract_payments_idempotency_key_uniq` exactly.
        target: [contractPayments.orgId, contractPayments.contractId, contractPayments.idempotencyKey],
        where: sql`idempotency_key is not null`,
      })
      .returning({ id: contractPayments.id }),
    target.outstanding,
  );
  if (inserted.length > 0) return { inserted: inserted[0].id };
  // Lost the race to a write of the same key: that row, no second audit.
  const existing = await findKeyedPayment(tx, target.contractId, idempotencyKey);
  if (existing === null) throw new Error('appendKeyedContractPayment: conflict without a row');
  return { replayed: existing };
}
