// Design-Engagement Machine — guard engine (Step 2, widened in Step 4). PURE and
// CLIENT-SAFE: guards are total predicates over a pre-loaded facts bundle. A
// guard NEVER takes a `tx`, does I/O, or touches the DB — the executor gathers
// every fact first, then guards only decide. Its runtime dependencies are the
// pure, client-safe scale-4 money helpers (`parseMoney4` / `pctOf`) and the
// erased `@metra/db` types. Later steps WIDEN `GuardFacts` (artifacts, revision
// counters) without changing this contract.
import type {
  DesignEngagement,
  EngagementArtifact,
  EngagementMilestone,
  MilestoneKind,
  PaymentEvent,
} from '@metra/db';
import type { ActionCode } from '@/lib/actions/result';
// Relative (not '@/'): guards.ts is exercised by a PLAIN `vitest run` unit test
// with no path-alias plugin, so its runtime imports must resolve without '@/'.
import { parseMoney4, pctOf } from '../aggregates/proposal-totals';

/**
 * The facts a guard may read. Widened in Step 4 (fee-schedule `milestones` + the
 * append-only `payments` ledger) and Step 5 (the recorded `artifacts`), so each
 * gate can decide from pure data the executor pre-loaded.
 */
export interface GuardFacts {
  engagement: DesignEngagement;
  milestones: EngagementMilestone[];
  payments: PaymentEvent[];
  artifacts: EngagementArtifact[];
}

/** A guard's verdict: pass, or fail with the coded reason to surface. */
export type GuardResult = { ok: true } | { ok: false; code: ActionCode };

/** Guard identifiers referenced by the transition registry. */
export type GuardKey =
  | 'scopeInputsPresent'
  | 'depositCleared'
  | 'gateAInstallmentCleared'
  | 'spatialBaseReady'
  | 'optionsReady'
  | 'pendingGuard';

const pass: GuardResult = { ok: true };

/**
 * The engagement's scope is complete enough to be shown to a client: a bilingual
 * title (Arabic OR English present) plus a resolved client and project. This is
 * the gate for `submitDesignFee` — you cannot put a fee in front of a client on
 * an unnamed, unassigned job.
 */
function scopeInputsPresent(facts: GuardFacts): GuardResult {
  const { titleAr, titleEn, clientId, projectId } = facts.engagement;
  const hasTitle = Boolean(titleAr?.trim()) || Boolean(titleEn?.trim());
  if (!hasTitle || !clientId || !projectId) {
    return { ok: false, code: 'guard_scope_inputs_missing' };
  }
  return pass;
}

/**
 * Shared installment-clearance math for a milestone-gated money guard. Computes
 * the REQUIRED amount for the `kind` milestone from the milestone row + `design_fee`
 * in exact scale-4 BigInt (never parseFloat):
 *   - basis `amount`  → required = the milestone's `value`.
 *   - basis `percent` → required = design_fee × (milestone% / 100), via `pctOf`
 *     (round half away from zero — the SAME rule as the proposal money engine).
 * PAID = Σ `amount` of the engagement's payment events of the SAME `kind` (every
 * `payment_events` row is a cleared payment in the manual model). Passes iff
 * paid ≥ required, else fails with the caller-supplied `code`. FAILS CLOSED (with
 * `code`) if the milestone or the design_fee is missing — which cannot happen
 * after Step 3, but a gate on money must never open on absent facts.
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
  const milestone = facts.milestones.find((m) => m.kind === kind);
  const designFee = facts.engagement.designFee;
  if (!milestone || !designFee) {
    return { ok: false, code };
  }

  const required =
    milestone.basis === 'amount'
      ? parseMoney4(milestone.value)
      : pctOf(parseMoney4(designFee), parseMoney4(milestone.value));

  const paid = facts.payments.reduce(
    (sum, payment) =>
      payment.kind === kind ? sum + parseMoney4(payment.amount) : sum,
    0n,
  );

  if (paid < required) return { ok: false, code };
  return pass;
}

/**
 * The engagement's deposit is fully paid — the gate for `confirmAndPayDeposit`.
 * Delegates to {@link milestoneCleared} for the `deposit` milestone, surfacing
 * `deposit_not_cleared` on any shortfall or absent fact.
 */
function depositCleared(facts: GuardFacts): GuardResult {
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
function gateAInstallmentCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'gate_a', 'gate_a_not_cleared');
}

/**
 * The engagement has a stored spatial base — the gate for `spatialBaseReady`
 * (survey -> layout). The Off-Plan rule decides which attested artifact suffices:
 *   - Off-Plan (`offPlan === true`): a developer CAD set is accepted in lieu of a
 *     measured survey, so pass if an `autocad` OR `survey` artifact exists.
 *   - non-Off-Plan (`offPlan === false`): a measured `survey` is required — a CAD
 *     alone does NOT satisfy it.
 * Fails closed with `spatial_base_missing` when no qualifying artifact is present.
 */
function spatialBaseReady(facts: GuardFacts): GuardResult {
  const hasKind = (kind: EngagementArtifact['kind']): boolean =>
    facts.artifacts.some((artifact) => artifact.kind === kind);

  if (facts.engagement.offPlan) {
    if (hasKind('autocad') || hasKind('survey')) return pass;
    return { ok: false, code: 'spatial_base_missing' };
  }

  if (hasKind('survey')) return pass;
  return { ok: false, code: 'spatial_base_missing' };
}

/**
 * The engagement has a valid set of concept options to put in front of the client
 * — the gate for `optionsReady` (layout -> concept_review). The spec requires
 * "2–4 concept options exist": too few is not a real choice, too many dilutes the
 * decision. Counts ONLY `concept_option` artifacts (a survey or CAD in the bundle
 * never counts) and passes iff that count is between 2 and 4 inclusive. Fails
 * closed with `concept_options_out_of_range` at 0, 1, or 5+.
 */
function optionsReady(facts: GuardFacts): GuardResult {
  const conceptOptionCount = facts.artifacts.filter(
    (artifact) => artifact.kind === 'concept_option',
  ).length;

  if (conceptOptionCount < 2 || conceptOptionCount > 4) {
    return { ok: false, code: 'concept_options_out_of_range' };
  }
  return pass;
}

/**
 * Fail-closed sentinel for triggers whose real guard belongs to a later step.
 * It always denies with `transition_not_yet_enabled`, so a declared-but-unwired
 * transition can never fire early. Replaced by concrete guards in later steps.
 */
function pendingGuard(): GuardResult {
  return { ok: false, code: 'transition_not_yet_enabled' };
}

/** The guard registry — the executor resolves a GuardKey to its predicate here. */
export const GUARDS: Record<GuardKey, (facts: GuardFacts) => GuardResult> = {
  scopeInputsPresent,
  depositCleared,
  gateAInstallmentCleared,
  spatialBaseReady,
  optionsReady,
  pendingGuard,
};
