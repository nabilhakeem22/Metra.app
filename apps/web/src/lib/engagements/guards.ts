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
  EngagementChangeOrder,
  EngagementEvent,
  EngagementMilestone,
  MilestoneBasis,
  MilestoneKind,
  PaymentEvent,
} from '@metra/db';
import type { ActionCode } from '@/lib/actions/result';
// Relative (not '@/'): guards.ts is exercised by a PLAIN `vitest run` unit test
// with no path-alias plugin, so its runtime imports must resolve without '@/'.
import { parseMoney4, pctOf } from '../aggregates/proposal-totals';
// Relative import (same client-safe guarantee as guards.ts): the transition
// registry is pure static data; transitions.ts only type-imports guards.ts back
// (erased), so this introduces no runtime cycle.
import { TRANSITIONS, type Trigger } from './transitions';

/**
 * The facts a guard may read. Widened in Step 4 (fee-schedule `milestones` + the
 * append-only `payments` ledger), Step 5 (the recorded `artifacts`), Step 9
 * (the `changeOrders` raised by over-allowance revisions), and Step 13 (the
 * append-only `events` ledger), so each gate can decide from pure data the
 * executor pre-loaded.
 */
export interface GuardFacts {
  engagement: DesignEngagement;
  milestones: EngagementMilestone[];
  payments: PaymentEvent[];
  artifacts: EngagementArtifact[];
  changeOrders: EngagementChangeOrder[];
  events: EngagementEvent[];
}

/** A guard's verdict: pass, or fail with the coded reason to surface. */
export type GuardResult = { ok: true } | { ok: false; code: ActionCode };

/** Guard identifiers referenced by the transition registry. */
export type GuardKey =
  | 'scopeInputsPresent'
  | 'depositCleared'
  | 'gateAInstallmentCleared'
  | 'gateBInstallmentCleared'
  | 'romAcknowledged'
  | 'asBuiltReconciled'
  | 'spatialBaseReady'
  | 'optionsReady'
  | 'revisionCosSettled'
  | 'rendersPresent'
  | 'asBuiltDueOpen'
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
 * The engagement's Gate-B installment is fully paid — a money gate for
 * `approveDesign` (final_approval -> shop_drawings). Delegates to
 * {@link milestoneCleared} for the `gate_b` milestone, surfacing
 * `gate_b_not_cleared` on any shortfall. Absent gate_b milestone = free gate: a
 * schedule that omits gate_b clears without a gate_b payment.
 */
function gateBInstallmentCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'gate_b', 'gate_b_not_cleared');
}

/**
 * The client has acknowledged the firm's ROM band — a gate for `approveDesign`.
 * `recordRomAcknowledgement` (Step 12) appends one `rom_acknowledgement` event
 * snapshotting the acknowledged range; the design cannot be approved until that
 * witness exists. Fails closed with `rom_not_acknowledged` when none is present.
 */
function romAcknowledged(facts: GuardFacts): GuardResult {
  return facts.events.some((event) => event.kind === 'rom_acknowledgement')
    ? pass
    : { ok: false, code: 'rom_not_acknowledged' };
}

/**
 * Newest-first ordering for engagement events: primary `decidedAt`, tie-broken by
 * `createdAt`, then `id` — the deterministic total order the latest-attestation
 * gate reads. Descending, so the freshest event sorts to index 0.
 */
function byDecidedDescending(a: EngagementEvent, b: EngagementEvent): number {
  const decided = b.decidedAt.getTime() - a.decidedAt.getTime();
  if (decided !== 0) return decided;
  const created = b.createdAt.getTime() - a.createdAt.getTime();
  if (created !== 0) return created;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * The as-built drawings are reconciled — a gate for `approveDesign`. A non-Off-Plan
 * engagement never has as-built drawings due (`asBuiltDue === false`), so it is
 * trivially reconciled and passes. For an Off-Plan engagement the LATEST
 * `as_built_attestation` event (newest by decidedAt/createdAt/id) must be a clean
 * one (`hasVariance === false`); a variance-flagged latest attestation, or NO
 * attestation at all, fails closed with `as_built_not_reconciled`.
 */
function asBuiltReconciled(facts: GuardFacts): GuardResult {
  if (!facts.engagement.asBuiltDue) return pass;

  const [latest] = facts.events
    .filter((event) => event.kind === 'as_built_attestation')
    .sort(byDecidedDescending);

  if (!latest || latest.hasVariance !== false) {
    return { ok: false, code: 'as_built_not_reconciled' };
  }
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
function revisionCosSettled(facts: GuardFacts): GuardResult {
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

/**
 * The engagement has at least one approved render — the gate for `rendersReady`
 * (design_3d -> final_approval). The spec table lists this edge with no guard,
 * but declaring renders ready with ZERO approved renders is meaningless: the
 * captured baseline manifest would hash an empty set. This light product rule
 * ("you cannot advance with no renders") is an INTENTIONAL deviation — remove it
 * if the owner wants zero-render advancement. Counts ONLY `approved_render`
 * artifacts; a survey/CAD/concept option in the bundle never satisfies it. Fails
 * closed with `renders_missing` when none is present.
 */
function rendersPresent(facts: GuardFacts): GuardResult {
  const hasApprovedRender = facts.artifacts.some(
    (artifact) => artifact.kind === 'approved_render',
  );
  if (!hasApprovedRender) return { ok: false, code: 'renders_missing' };
  return pass;
}

/**
 * The as-built drawings are due — the gate for the Gate-B as-built attestations
 * (`flagAsBuiltVariance`, `attestAsBuiltClean`). `as_built_due` is set true at
 * `confirmAndPayDeposit` for an Off-Plan engagement; a non-Off-Plan engagement
 * never becomes due, so it cannot flag a variance or attest a clean as-built.
 * Fails closed with `as_built_not_due` when the drawings are not (yet) due.
 */
function asBuiltDueOpen(facts: GuardFacts): GuardResult {
  return facts.engagement.asBuiltDue === true
    ? pass
    : { ok: false, code: 'as_built_not_due' };
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
  gateBInstallmentCleared,
  romAcknowledged,
  asBuiltReconciled,
  spatialBaseReady,
  optionsReady,
  revisionCosSettled,
  rendersPresent,
  asBuiltDueOpen,
  pendingGuard,
};
