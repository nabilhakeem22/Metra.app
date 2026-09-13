// Design-Engagement Machine, Step 9 — WHICH revision_co payment settled WHICH
// change order. PURE and CLIENT-SAFE: exact scale-4 BigInt allocation with no
// database access, so the pairing rule is unit-testable on its own.
// Relative (not '@/'): mirrors the guard modules, which are exercised by a plain
// `vitest run` with no path-alias plugin.
import { parseMoney4 } from '../aggregates/proposal-totals';

export interface SettlementRow {
  id: string;
  amount: string;
}

export interface SettlementLink {
  changeOrderId: string;
  paymentEventId: string | null;
}

/**
 * FIFO allocation of revision_co payment credit to raised change orders.
 *
 * Both queues are in their natural order — change orders by raised_at then id,
 * payments by cleared_at then id — so the oldest debt is covered by the oldest
 * money, which is what a client reading a statement expects.
 *
 * `alreadyConsumed4` is the total of the change orders this engagement has
 * ALREADY settled. It is drained off the front of the payment queue first,
 * because those payments are spent: without that, credit that paid for an
 * earlier change order would be counted again here.
 *
 * THE ORDER IS ONLY AS DETERMINISTIC AS THE TIMESTAMPS. raised_at and cleared_at
 * default to now(), which is fixed at BEGIN, so two change orders (or two
 * revision_co payments) written in ONE transaction share a timestamp and fall
 * back to the id tie-break — a random UUID, i.e. a coin flip. Today nothing
 * writes two of either in one transaction, so the queues are strictly ordered;
 * a future bulk path that does would make the LINK non-deterministic (the total
 * settled is unaffected: the allocation is exact either way).
 *
 * A change order links to the payment that COMPLETED its cover, which is why a
 * change order spanning two partial payments points at the second. When the
 * credit runs out `paymentEventId` is null for the remaining change orders —
 * the caller MUST treat that as a failure and settle nothing, never silently
 * mark a change order settled with no payment behind it.
 */
export function allocateSettlements(
  raised: SettlementRow[],
  payments: SettlementRow[],
  alreadyConsumed4: bigint,
): SettlementLink[] {
  let creditInHand4 = -alreadyConsumed4;
  let paymentIndex = 0;
  let lastDrawnPaymentId: string | null = null;
  const links: SettlementLink[] = [];

  for (const changeOrder of raised) {
    const owed4 = parseMoney4(changeOrder.amount);
    while (creditInHand4 < owed4 && paymentIndex < payments.length) {
      creditInHand4 += parseMoney4(payments[paymentIndex].amount);
      lastDrawnPaymentId = payments[paymentIndex].id;
      paymentIndex += 1;
    }
    if (creditInHand4 < owed4) {
      links.push({ changeOrderId: changeOrder.id, paymentEventId: null });
      continue;
    }
    creditInHand4 -= owed4;
    links.push({
      changeOrderId: changeOrder.id,
      paymentEventId: lastDrawnPaymentId,
    });
  }
  return links;
}
