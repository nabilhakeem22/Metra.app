// Design-Engagement Machine, Step 9 — the `settleConceptAndLock` side-effect of
// `confirmConcept` (negotiation -> design_3d). Executor-only: MUST be called with
// the executor's `tx` so the change-order settlement and the concept lock commit
// ATOMICALLY with the negotiation -> design_3d state move, or roll back together.
import {
  designEngagements,
  engagementChangeOrders,
  paymentEvents,
  type MetraDb,
} from '@metra/db';
import { and, asc, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { allocateSettlements, type SettlementRow } from './co-settlement';

interface SettlementInputs {
  raised: SettlementRow[];
  payments: SettlementRow[];
  alreadyConsumed4: bigint;
}

/**
 * The three facts the allocation needs, scoped to one engagement and read in the
 * queue order the allocator assumes: raised change orders oldest first, cleared
 * revision_co payments oldest first, and the total of the change orders this
 * engagement has ALREADY settled (credit that is spent).
 */
async function loadSettlementInputs(
  tx: MetraDb,
  engagementId: string,
): Promise<SettlementInputs> {
  const changeOrders = await tx
    .select({
      id: engagementChangeOrders.id,
      amount: engagementChangeOrders.amount,
      status: engagementChangeOrders.status,
    })
    .from(engagementChangeOrders)
    .where(eq(engagementChangeOrders.engagementId, engagementId))
    .orderBy(
      asc(engagementChangeOrders.raisedAt),
      asc(engagementChangeOrders.id),
    );

  const payments = await tx
    .select({ id: paymentEvents.id, amount: paymentEvents.amount })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.engagementId, engagementId),
        eq(paymentEvents.kind, 'revision_co'),
      ),
    )
    .orderBy(asc(paymentEvents.clearedAt), asc(paymentEvents.id));

  return {
    raised: changeOrders.filter((row) => row.status === 'raised'),
    payments,
    alreadyConsumed4: changeOrders.reduce(
      (sum, row) =>
        row.status === 'settled' ? sum + parseMoney4(row.amount) : sum,
      0n,
    ),
  };
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
  if (links.some((link) => link.paymentEventId === null)) {
    fail('revision_cos_outstanding');
  }

  const now = new Date();
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

  await tx
    .update(designEngagements)
    .set({ conceptLockedAt: now, updatedAt: now })
    .where(eq(designEngagements.id, engagementId));
}
