// Design-Engagement Machine, Step 9 — the `settleConceptAndLock` side-effect of
// `confirmConcept` (negotiation -> design_3d). Executor-only: MUST be called with
// the executor's `tx` so the change-order settlement and the concept lock commit
// ATOMICALLY with the negotiation -> design_3d state move, or roll back together.
// The `revisionCosSettled` guard has already proven every outstanding change order
// is fully covered by cleared revision_co payments, so this settles ALL raised
// change orders unconditionally and stamps the concept lock.
import {
  designEngagements,
  engagementChangeOrders,
  type MetraDb,
} from '@metra/db';
import { and, eq } from 'drizzle-orm';

/**
 * Settle every `raised` change order on `engagementId` (status -> `settled`,
 * `settled_at` = now()) and stamp the engagement's `concept_locked_at`. Both
 * UPDATEs run inside the executor's tx so they commit atomically with the
 * negotiation -> design_3d state move — a guard failure earlier in the tx leaves
 * the change orders `raised` and `concept_locked_at` null. Settling is
 * unconditional because the guard proved the outstanding total is covered; a
 * no-op UPDATE (no raised rows) is harmless. RLS scopes both UPDATEs to the
 * caller's org via the ambient tx context.
 */
export async function settleConceptAndLock(
  tx: MetraDb,
  engagementId: string,
): Promise<void> {
  const now = new Date();
  await tx
    .update(engagementChangeOrders)
    .set({ status: 'settled', settledAt: now })
    .where(
      and(
        eq(engagementChangeOrders.engagementId, engagementId),
        eq(engagementChangeOrders.status, 'raised'),
      ),
    );
  await tx
    .update(designEngagements)
    .set({ conceptLockedAt: now, updatedAt: now })
    .where(eq(designEngagements.id, engagementId));
}
