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
  | 'spatialBaseReady'
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
 * The engagement's deposit is fully paid — the gate for `confirmAndPayDeposit`.
 * Computes the REQUIRED deposit from the `deposit` milestone + `design_fee` in
 * exact scale-4 BigInt (never parseFloat):
 *   - basis `amount`  → required = the deposit milestone's `value`.
 *   - basis `percent` → required = design_fee × (deposit% / 100), via `pctOf`
 *     (round half away from zero — the SAME rule as the proposal money engine).
 * PAID = Σ `amount` of the engagement's `deposit` payment events (every
 * `payment_events` row is a cleared payment in the manual model). Passes iff
 * paid ≥ required. FAILS CLOSED (`deposit_not_cleared`) if the deposit milestone
 * or the design_fee is missing — which cannot happen after Step 3, but a gate on
 * money must never open on absent facts.
 */
function depositCleared(facts: GuardFacts): GuardResult {
  const deposit = facts.milestones.find((m) => m.kind === 'deposit');
  const designFee = facts.engagement.designFee;
  if (!deposit || !designFee) {
    return { ok: false, code: 'deposit_not_cleared' };
  }

  const required =
    deposit.basis === 'amount'
      ? parseMoney4(deposit.value)
      : pctOf(parseMoney4(designFee), parseMoney4(deposit.value));

  const paid = facts.payments.reduce(
    (sum, payment) =>
      payment.kind === 'deposit' ? sum + parseMoney4(payment.amount) : sum,
    0n,
  );

  if (paid < required) return { ok: false, code: 'deposit_not_cleared' };
  return pass;
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
  spatialBaseReady,
  pendingGuard,
};
