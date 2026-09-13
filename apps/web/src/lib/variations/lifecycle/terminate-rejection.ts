// Closing out a contract's undecided variation orders when the contract is
// terminated. Called BY contracts/lifecycle inside its transaction — the
// dependency runs contracts -> variations only, never the other way.
import {
  type MetraDb,
  type VariationStatus,
  variationOrderEvents,
  variationOrders,
} from '@metra/db';
import { eq, inArray } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { variationsToRejectOnTermination } from '../lifecycle-rules';

export interface RejectedVariation {
  id: string;
  fromStatus: VariationStatus;
}

/**
 * Reject every still-undecided (draft / internal_approved / issued) variation
 * order on a terminated contract, and append one event per rejection. Already
 * decided VOs (approved, rejected) are left exactly as they are.
 *
 * The whole VO set of the contract is locked FOR UPDATE first, so a concurrent
 * internal-approve or issue either runs before this (and is then rejected here)
 * or after it (and finds the contract terminated). The UPDATE sets ONLY status
 * and updated_at: enforce_immutable_when raises MT100 on a locked row whose
 * update touches any other column.
 */
export async function rejectVariationsOnContractTermination(
  tx: MetraDb,
  ctx: OrgContext,
  contractId: string,
): Promise<RejectedVariation[]> {
  const locked = await tx
    .select({ id: variationOrders.id, status: variationOrders.status })
    .from(variationOrders)
    .where(eq(variationOrders.contractId, contractId))
    .for('update');
  const open = locked.filter((vo) => variationsToRejectOnTermination(vo.status));
  if (open.length === 0) return [];

  await tx
    .update(variationOrders)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(
      inArray(
        variationOrders.id,
        open.map((vo) => vo.id),
      ),
    );

  await tx.insert(variationOrderEvents).values(
    open.map((vo) => ({
      orgId: ctx.orgId,
      variationOrderId: vo.id,
      kind: 'rejected',
      actorUserId: ctx.userId,
      fromStatus: vo.status,
      toStatus: 'rejected',
    })),
  );

  return open.map((vo) => ({ id: vo.id, fromStatus: vo.status }));
}
