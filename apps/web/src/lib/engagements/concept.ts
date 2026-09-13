// Design-Engagement Machine, Step 9 — the `settleConceptAndLock` side-effect of
// `confirmConcept` (negotiation -> design_3d). Executor-only: MUST be called with
// the executor's `tx` so the change-order settlement and the concept lock commit
// ATOMICALLY with the negotiation -> design_3d state move, or roll back together.
import { designEngagements, engagementChangeOrders, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { allocateSettlements, type SettlementLink } from './co-settlement';
import { loadSettlementInputs } from './concept-settlement-inputs';

/**
 * Stamp each allocated change order as settled. Each UPDATE is gated on
 * `status = 'raised'` so a concurrent settle cannot relink one already settled.
 */
async function linkSettlements(
  tx: MetraDb,
  links: ReturnType<typeof allocateSettlements>,
  now: Date,
): Promise<void> {
  for (const link of links) {
    await tx
      .update(engagementChangeOrders)
      .set({
        status: 'settled',
        settledAt: now,
        settledByPaymentEventId: link.paymentEventId,
      })
      .where(
        and(
          eq(engagementChangeOrders.id, link.changeOrderId),
          eq(engagementChangeOrders.status, 'raised'),
        ),
      );
  }
}

/**
 * UNREACHABLE IF THE GUARD IS RIGHT. `revisionCosSettled` ran moments ago on this
 * transaction's facts and said the credit was there, so a shortfall here means
 * the guard and the allocator disagree. Without this line the transaction rolls
 * back silently and reads to the studio as a random failure. Ids only, no amounts.
 */
function reportImpossibleShortfall(
  engagementId: string,
  raisedCount: number,
  paymentCount: number,
  uncovered: SettlementLink[],
): void {
  console.error('[engagements] settlement failed after guard passed', {
    engagementId,
    raised: raisedCount,
    payments: paymentCount,
    uncovered: uncovered.map((link) => link.changeOrderId),
  });
}

/**
 * Settle every `raised` change order on `engagementId` (status -> `settled`,
 * `settled_at` = now(), `settled_by_payment_event_id` = the revision_co payment
 * that completed its cover) and stamp the engagement's `concept_locked_at`.
 *
 * The `revisionCosSettled` guard has already proven the credit is there, so this
 * normally settles everything. It re-derives the allocation rather than assuming
 * it: if any change order comes back with no payment behind it the whole
 * transaction fails with `revision_cos_outstanding`, because a change order
 * marked settled with nothing behind it is money nobody can ever account for.
 * Each UPDATE is gated on `status = 'raised'` so a concurrent settle cannot
 * relink an already settled change order. A guard failure earlier in the tx
 * leaves every change order `raised` and `concept_locked_at` null. RLS scopes
 * every statement to the caller's org via the ambient tx context.
 */
export async function settleConceptAndLock(
  tx: MetraDb,
  engagementId: string,
): Promise<void> {
  const { raised, payments, alreadyConsumed4 } = await loadSettlementInputs(
    tx,
    engagementId,
  );
  const links = allocateSettlements(raised, payments, alreadyConsumed4);
  const uncovered = links.filter((link) => link.paymentEventId === null);
  if (uncovered.length > 0) {
    reportImpossibleShortfall(engagementId, raised.length, payments.length, uncovered);
    fail('revision_cos_outstanding');
  }

  const now = new Date();
  await linkSettlements(tx, links, now);

  await tx
    .update(designEngagements)
    .set({ conceptLockedAt: now, updatedAt: now })
    .where(eq(designEngagements.id, engagementId));
}
