// The READS behind a concept settlement: the change-order queue, the revision_co
// payment queue, and the credit already spent. Split out of concept.ts so that
// file is the WRITE (settle, link, lock) and this one is the evidence it acts on.
import { engagementChangeOrders, paymentEvents, type MetraDb } from '@metra/db';
import { and, asc, eq } from 'drizzle-orm';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { SettlementRow } from './co-settlement';

export interface SettlementInputs {
  raised: SettlementRow[];
  payments: SettlementRow[];
  alreadyConsumed4: bigint;
}

/** Every change order on the engagement, oldest first — the queue order the
 *  allocator assumes. Both statuses: the settled ones are spent credit. */
async function loadChangeOrderQueue(tx: MetraDb, engagementId: string) {
  return tx
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
}

/** The cleared revision_co payments on the engagement, oldest first. */
async function loadRevisionPayments(tx: MetraDb, engagementId: string) {
  return tx
    .select({ id: paymentEvents.id, amount: paymentEvents.amount })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.engagementId, engagementId),
        eq(paymentEvents.kind, 'revision_co'),
      ),
    )
    .orderBy(asc(paymentEvents.clearedAt), asc(paymentEvents.id));
}

/**
 * The three facts the allocation needs, scoped to one engagement: raised change
 * orders, cleared revision_co payments, and the total of the change orders this
 * engagement has ALREADY settled (credit that is spent).
 */
export async function loadSettlementInputs(
  tx: MetraDb,
  engagementId: string,
): Promise<SettlementInputs> {
  const changeOrders = await loadChangeOrderQueue(tx, engagementId);
  return {
    raised: changeOrders.filter((row) => row.status === 'raised'),
    payments: await loadRevisionPayments(tx, engagementId),
    alreadyConsumed4: changeOrders.reduce(
      (sum, row) =>
        row.status === 'settled' ? sum + parseMoney4(row.amount) : sum,
      0n,
    ),
  };
}
