// Design-Engagement Machine — money guard family (Step 4 / Step 9). PURE and
// CLIENT-SAFE: the milestone-clearance and change-order-settlement gates plus the
// exact scale-4 money math (`milestoneRequired4` / `milestoneShortfall4`) the gate
// preview reuses, so a firm's "amount due" is the SAME figure the guard admits. Its
// runtime dependencies are the pure scale-4 money helpers (`parseMoney4` / `pctOf`)
// and the erased `@metra/db` types.
import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import type { ActionCode } from '@/lib/actions/result';
// Relative (not '@/'): the guard modules are exercised by a PLAIN `vitest run` unit
// test with no path-alias plugin, so their runtime imports must resolve without '@/'.
import { parseMoney4, pctOf } from '../../aggregates/proposal-totals';
// Relative import (same client-safe guarantee): the transition registry is pure
// static data; transitions.ts only type-imports guards back (erased), so this
// introduces no runtime cycle.
import { TRANSITIONS, type Trigger } from '../transitions';
import { pass, type GuardFacts, type GuardKey, type GuardResult } from './facts';

/**
 * Shared installment-clearance math for a milestone-gated money guard. Computes
 * the REQUIRED amount for the `kind` milestone from the milestone row + `design_fee`
 * in exact scale-4 BigInt (never parseFloat):
 *   - basis `amount`  → required = the milestone's `value`.
 *   - basis `percent` → required = design_fee × (milestone% / 100), via `pctOf`
 *     (round half away from zero — the SAME rule as the proposal money engine).
 * PAID = Σ `amount` of the engagement's payment events of the SAME `kind` (every
 * `payment_events` row is a cleared payment in the manual model). Passes iff
 * paid ≥ required, else fails with the caller-supplied `code`.
 *
 * ABSENT MILESTONE = FREE GATE (owner-locked): if the firm omitted this `kind`
 * from the fee schedule, there is nothing to pay for it — required is 0 and the
 * gate clears with no payment (paid 0 ≥ required 0). `deposit` is always present
 * after Step 3, so `depositCleared` is unaffected; a deposit-only schedule now
 * lets `gate_a`/`gate_b` clear free. Only when the milestone EXISTS is a required
 * amount computed — and it still FAILS CLOSED (with `code`) if the design_fee is
 * missing, since a scheduled money gate must never open on absent fee facts.
 *
 * `payment_event_kind` is a superset of `milestone_kind` (it adds `revision_co`),
 * but the four milestone kinds share a spelling, so summing payments whose
 * `kind === milestoneKind` matches receipts to their scheduled slice exactly.
 */
function milestoneCleared(
  facts: GuardFacts,
  kind: MilestoneKind,
  code: ActionCode,
): GuardResult {
  const { required, paid } = milestoneRequiredAndPaid(facts, kind);
  // `required === null`: the milestone exists but the design fee is missing, so
  // the amount can't be computed — a scheduled money gate must fail closed.
  if (required === null) return { ok: false, code };
  if (paid < required) return { ok: false, code };
  return pass;
}

/**
 * The exact scale-4 REQUIRED and PAID amounts backing a milestone-gated money
 * guard — the single arithmetic {@link milestoneCleared} and the hero's gate
 * preview both read, so the "amount due" a firm sees is computed by the SAME math
 * that admits the transition (no reinvented formula):
 *   - ABSENT milestone → `required = 0n` (free gate: nothing to pay).
 *   - milestone present, design fee MISSING → `required = null` (cannot compute;
 *     the guard fails closed and there is no numeric shortfall to surface).
 *   - milestone present + design fee set → `required` = the `amount` value or
 *     `pctOf(fee, pct)`, exactly as the guard computes it.
 * `paid` is Σ of the engagement's payment events of the SAME `kind`.
 */
function milestoneRequiredAndPaid(
  facts: GuardFacts,
  kind: MilestoneKind,
): { required: bigint | null; paid: bigint } {
  const paid = facts.payments.reduce(
    (sum, payment) =>
      payment.kind === kind ? sum + parseMoney4(payment.amount) : sum,
    0n,
  );

  const milestone = facts.milestones.find((m) => m.kind === kind);
  if (!milestone) return { required: 0n, paid };

  return {
    required: milestoneRequired4(
      milestone.basis,
      milestone.value,
      facts.engagement.designFee,
    ),
    paid,
  };
}

/**
 * The exact scale-4 REQUIRED amount one milestone resolves to, or `null` when it
 * cannot be computed. A `percent`-basis milestone needs the engagement's
 * `designFee` to become money (`pctOf` — the SAME round-half-away-from-zero rule as
 * the proposal engine); an `amount`-basis milestone carries its own value. Either
 * way an ABSENT design fee yields `null`: a scheduled money gate must never resolve
 * an amount on absent fee facts (fail closed). PURE, client-safe, never parseFloat —
 * shared by {@link milestoneRequiredAndPaid} (the guard) and the commercial-pulse
 * read-model, so a firm's "amount due" is the SAME figure the guard admits.
 */
export function milestoneRequired4(
  basis: MilestoneBasis,
  value: string,
  designFee: string | null | undefined,
): bigint | null {
  if (!designFee) return null;
  return basis === 'amount'
    ? parseMoney4(value)
    : pctOf(parseMoney4(designFee), parseMoney4(value));
}

/**
 * The scale-4 BigInt SHORTFALL (`required − paid`, clamped at 0) still owed on a
 * milestone money gate — the "amount due" the hero pre-fills into its pay-and-
 * advance form. Reuses {@link milestoneRequiredAndPaid}, so it can never drift
 * from what {@link milestoneCleared} admits. Returns 0n when the gate is already
 * satisfied, the milestone is absent (free gate), or the amount is uncomputable
 * (no design fee) — i.e. only a genuine positive shortfall is a real amount due.
 */
export function milestoneShortfall4(
  facts: GuardFacts,
  kind: MilestoneKind,
): bigint {
  const { required, paid } = milestoneRequiredAndPaid(facts, kind);
  if (required === null) return 0n;
  const shortfall = required - paid;
  return shortfall > 0n ? shortfall : 0n;
}

/**
 * The money guards whose shortfall the gate preview surfaces as an "amount due",
 * mapped to the milestone (and, since the three spellings coincide, payment) kind
 * they clear. The hero reads this to know a checklist item is a PAYMENT gate and
 * to pre-fill/route the pay-and-advance form. `revisionCosSettled` is a money gate
 * too but settles change orders (not a milestone), so it is deliberately absent —
 * it has no `milestoneCleared` shortfall.
 */
export const MONEY_GUARD_MILESTONE: Partial<Record<GuardKey, MilestoneKind>> = {
  depositCleared: 'deposit',
  gateAInstallmentCleared: 'gate_a',
  gateBInstallmentCleared: 'gate_b',
};

/**
 * The money-milestone guard a trigger carries, or `null` if it is not a payment
 * gate. Reads the trigger's declared guard list and returns the FIRST guard that
 * is a key of {@link MONEY_GUARD_MILESTONE} — so the pay-and-advance core can
 * verify the recorded payment kind matches the milestone the advance will clear
 * (blocking a gate_a receipt paired with `confirmAndPayDeposit`, etc.). PURE and
 * client-safe: reads only the static transition registry.
 *   - `confirmAndPayDeposit` -> `depositCleared`
 *   - `selectConcept`        -> `gateAInstallmentCleared`
 *   - `approveDesign`        -> `gateBInstallmentCleared` (its other guards —
 *     romAcknowledged, asBuiltReconciled — are not money gates)
 */
export function moneyGuardOf(trigger: Trigger): GuardKey | null {
  for (const guard of TRANSITIONS[trigger].guards) {
    if (guard in MONEY_GUARD_MILESTONE) return guard;
  }
  return null;
}

/**
 * The engagement's deposit is fully paid — the gate for `confirmAndPayDeposit`.
 * Delegates to {@link milestoneCleared} for the `deposit` milestone, surfacing
 * `deposit_not_cleared` on any shortfall or absent fact.
 */
export function depositCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'deposit', 'deposit_not_cleared');
}

/**
 * The engagement's Gate-A installment is fully paid — the gate for `selectConcept`
 * (concept_review → negotiation). Delegates to {@link milestoneCleared} for the
 * `gate_a` milestone, surfacing `gate_a_not_cleared` on any shortfall or absent
 * fact. The client/finance record the Gate-A receipt into the payment ledger
 * beforehand (`recordPaymentCore(kind:'gate_a')`); this guard only verifies it
 * cleared — consistent with the deposit model. No payment is collected here.
 */
export function gateAInstallmentCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'gate_a', 'gate_a_not_cleared');
}

/**
 * The engagement's Gate-B installment is fully paid — a money gate for
 * `approveDesign` (final_approval -> shop_drawings). Delegates to
 * {@link milestoneCleared} for the `gate_b` milestone, surfacing
 * `gate_b_not_cleared` on any shortfall. Absent gate_b milestone = free gate: a
 * schedule that omits gate_b clears without a gate_b payment.
 */
export function gateBInstallmentCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'gate_b', 'gate_b_not_cleared');
}

/**
 * Every outstanding change order is fully covered by cleared revision_co payments
 * — the money gate for `confirmConcept` (negotiation -> design_3d). Over-allowance
 * revisions raise `raised` change orders (Step 8); the concept can only lock once
 * those extra fees are settled. Math (exact scale-4 BigInt, never parseFloat):
 *   - `outstanding` = Σ `amount` of the engagement's `raised` change orders.
 *   - `paid`        = Σ `amount` of cleared `payment_events` of kind `revision_co`.
 * Passes iff `paid >= outstanding`. KIND-ISOLATION: only `revision_co` payments
 * settle a change order — a deposit/gate_a/gate_b/balance receipt of the same size
 * does NOT. With NO raised change orders `outstanding` is 0 (a raised CO's amount
 * is DB-CHECK > 0, so a zero sum means none are raised) and the gate passes
 * trivially. Otherwise a shortfall fails closed with `revision_cos_outstanding`.
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

  const paid = facts.payments.reduce(
    (sum, payment) =>
      payment.kind === 'revision_co' ? sum + parseMoney4(payment.amount) : sum,
    0n,
  );

  if (paid < outstanding) {
    return { ok: false, code: 'revision_cos_outstanding' };
  }
  return pass;
}
