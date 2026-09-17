// Design-Engagement Machine — CHANGE-ORDER SETTLEMENT (Step 9; split out of
// `guards/money.ts` in wave 4). PURE and CLIENT-SAFE. A settlement is a different
// money concept from an installment: it consumes CREDIT the client has already
// paid, rather than clearing a slice of a schedule — which is why it lives beside
// the milestone gates rather than among them.
import { parseMoney4 } from '../../aggregates/proposal-totals';
import { pass, type GuardFacts, type GuardResult } from './facts';

/**
 * Every outstanding change order is fully covered by revision_co payment credit
 * the client has NOT already spent — the money gate for `confirmConcept`
 * (negotiation -> design_3d). Over-allowance revisions raise `raised` change
 * orders (Step 8); the concept can only lock once those extra fees are settled.
 * Math (exact scale-4 BigInt, never parseFloat):
 *   - `outstanding` = Σ `amount` of the engagement's `raised` change orders.
 *   - `paid`        = Σ `amount` of cleared `payment_events` of kind `revision_co`.
 *   - `consumed`    = Σ `amount` of the engagement's ALREADY `settled` change
 *     orders — money that has been spent once and must not buy anything twice.
 * Passes iff `paid - consumed >= outstanding`. Without the `consumed` term a
 * client who paid 5000 for a first change order would have seen that same 5000
 * silently clear a second one: the payment ledger keeps the row forever, so the
 * raw total says "paid" long after the credit is gone.
 *
 * The rule is deliberately STATUS-based rather than link-based: change orders
 * settled before the settlement link existed carry no link, and counting only
 * linked ones would treat all of them as free. KIND-ISOLATION: only `revision_co`
 * payments settle a change order — a deposit/gate_a/gate_b/balance receipt of the
 * same size does NOT. With NO raised change orders `outstanding` is 0 (a raised
 * CO's amount is DB-CHECK > 0, so a zero sum means none are raised) and the gate
 * passes trivially. Otherwise a shortfall fails closed with
 * `revision_cos_outstanding`.
 */
export function revisionCosSettled(facts: GuardFacts): GuardResult {
  const outstanding = facts.changeOrders.reduce(
    (sum, changeOrder) =>
      changeOrder.status === 'raised'
        ? sum + parseMoney4(changeOrder.amount)
        : sum,
    0n,
  );
  if (outstanding === 0n) return pass;

  const consumed = facts.changeOrders.reduce(
    (sum, changeOrder) =>
      changeOrder.status === 'settled'
        ? sum + parseMoney4(changeOrder.amount)
        : sum,
    0n,
  );
  const paid = facts.payments.reduce(
    (sum, payment) =>
      payment.kind === 'revision_co' ? sum + parseMoney4(payment.amount) : sum,
    0n,
  );

  if (paid - consumed < outstanding) {
    return { ok: false, code: 'revision_cos_outstanding' };
  }
  return pass;
}
