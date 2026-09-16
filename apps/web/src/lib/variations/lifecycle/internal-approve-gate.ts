import 'server-only';
// The locks and gates an internal approval passes through, in order.
//
// These three are the whole reason this transition is safe, and each is a
// separate kind of safety: a ROW LOCK that serializes against a concurrent line
// rewrite, a CROSS-DOCUMENT check that the contract is still live, and an ATOMIC
// gate that freezes the total and flips the status in ONE statement.
import {
  contracts,
  variationOrders,
  type MetraDb,
  type VariationStatus,
} from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { fail, requireInOrg } from '@/lib/actions/mutate';
import { canInternalApproveVariation } from '../lifecycle-rules';

/**
 * Lock the VO row FOR UPDATE and refuse anything that is not a draft.
 *
 * The serialization point: a concurrent line rewrite also locks this row, so it
 * cannot slip between the sum below and the freeze.
 */
export async function lockDraftVariation(
  tx: MetraDb,
  variationOrderId: string,
): Promise<{ status: VariationStatus; contractId: string }> {
  const [locked] = await tx
    .select({
      status: variationOrders.status,
      contractId: variationOrders.contractId,
    })
    .from(variationOrders)
    .where(eq(variationOrders.id, variationOrderId))
    .for('update')
    .limit(1);
  if (!locked) fail('invalid');
  if (locked.status !== 'draft') fail('variation_not_draft');
  return locked;
}

/**
 * Freeze net_delta and flip draft -> internal_approved, IN ONE STATEMENT.
 *
 * net_delta = Σ line_total computed inside the UPDATE, so the read of the lines,
 * the freeze of the total and the status flip are atomic and a line rewrite can
 * never interleave between them. Equivalent to computeVariationNetDelta (both sum
 * line_total) and exact in SQL.
 */
export async function freezeAndApprove(
  tx: MetraDb,
  variationOrderId: string,
  tokenHash: string,
  shareExpiresAt: Date,
): Promise<void> {
  const gated = await tx
    .update(variationOrders)
    .set({
      status: 'internal_approved',
      netDelta: sql`(
        select coalesce(sum(line_total), 0)
        from public.variation_order_lines
        where variation_order_id = ${variationOrderId}
      )`,
      tokenHash,
      shareExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(variationOrders.id, variationOrderId),
        eq(variationOrders.status, 'draft'),
      ),
    )
    .returning({ id: variationOrders.id });
  if (!gated[0]) fail('variation_not_draft');
}

/**
 * The contract must still be live.
 *
 * A VO drafted before its contract was terminated must not become approvable
 * afterwards: a dead contract carries no commercial change.
 */
export async function assertContractStillLive(
  tx: MetraDb,
  variationStatus: VariationStatus,
  contractId: string,
): Promise<void> {
  const contract = await requireInOrg(
    tx,
    contracts,
    contractId,
    { status: contracts.status },
    'invalid',
  );
  if (!canInternalApproveVariation(variationStatus, contract.status)) {
    fail('contract_not_issued');
  }
}
