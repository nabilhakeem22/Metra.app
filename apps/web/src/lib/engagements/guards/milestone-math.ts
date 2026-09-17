// Design-Engagement Machine — MILESTONE MONEY MATH (Step 4; split out of
// `guards/money.ts` in wave 4). PURE and CLIENT-SAFE: the exact scale-4
// arithmetic shared by the milestone guards and by the gate preview, so a firm's
// "amount due" and "what the gate admits" are ONE formula and cannot drift.
// Never parseFloat.
import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import type { ActionCode } from '@/lib/actions/result';
// Relative (not '@/'): the guard modules are exercised by a PLAIN `vitest run` unit
// test with no path-alias plugin, so their runtime imports must resolve without '@/'.
import { parseMoney4, pctOf } from '../../aggregates/proposal-totals';
import { pass, type GuardFacts, type GuardResult } from './facts';

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
export function milestoneCleared(
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
