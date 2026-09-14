// Design-Engagement Machine — readiness guard family (Step 2, widened in Steps
// 5/12/13/14 and the tail wiring). PURE and CLIENT-SAFE: the scope, artifact
// (survey / CAD / concept options / renders / shop drawings / BOQ), and
// attestation-event (ROM ack, as-built, handoff ack) gates that decide whether
// the design is ready to advance, plus the fail-closed `pendingGuard` sentinel.
// Its only dependencies are the erased `@metra/db` types.
import type { EngagementArtifact, EngagementEvent } from '@metra/db';
import { acknowledgesIssuance } from '../rom-ack';
import { pass, type GuardFacts, type GuardResult } from './facts';

/**
 * The engagement's scope is complete enough to be shown to a client: a bilingual
 * title (Arabic OR English present) plus a resolved client and project. This is
 * the gate for `submitDesignFee` — you cannot put a fee in front of a client on
 * an unnamed, unassigned job.
 */
export function scopeInputsPresent(facts: GuardFacts): GuardResult {
  const { titleAr, titleEn, clientId, projectId } = facts.engagement;
  const hasTitle = Boolean(titleAr?.trim()) || Boolean(titleEn?.trim());
  if (!hasTitle || !clientId || !projectId) {
    return { ok: false, code: 'guard_scope_inputs_missing' };
  }
  return pass;
}

/** A numeric(18,4) string in a comparable form: no leading zeros, no trailing
 *  fractional zeros, so '1800000' and '1800000.0000' are the same amount. */
function normalizedAmount(value: string): string {
  const [whole, fraction = ''] = value.trim().split('.');
  return `${whole.replace(/^\+?0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
}

/** Do both bounds of a snapshotted range equal the engagement's current band? */
function matchesCurrentBand(
  event: EngagementEvent,
  romLow: string | null,
  romHigh: string | null,
): boolean {
  if (romLow === null || romHigh === null) return false;
  if (event.rangeLow === null || event.rangeHigh === null) return false;
  return (
    normalizedAmount(event.rangeLow) === normalizedAmount(romLow) &&
    normalizedAmount(event.rangeHigh) === normalizedAmount(romHigh)
  );
}

/**
 * The client has acknowledged THE BAND THAT IS ON THE ENGAGEMENT NOW — a gate for
 * `approveDesign`. `recordRomAcknowledgement` (Step 12) appends one
 * `rom_acknowledgement` event snapshotting the acknowledged range.
 *
 * EXISTENCE IS NOT ENOUGH. Re-setting the band clears `rom_issued_at`, so an
 * engagement whose figures have moved since the client agreed to them would
 * otherwise still pass this gate on the old consent — the design would be signed
 * off against numbers the client never saw. FOUR conditions now, all fail-closed
 * with `rom_not_acknowledged`: the band must be issued, the newest
 * acknowledgement must exist, it must answer THE CURRENT ISSUANCE (0049), and
 * its snapshotted range must equal the current band.
 *
 * The issuance check and the band check are both kept, deliberately. The issuance
 * check is the strong one — it catches a re-issue of the SAME numbers, which the
 * band comparison cannot see. The band comparison stays because it also covers
 * the rows that carry no issuance stamp at all, and because two independent
 * reasons to refuse are the right posture for a gate that signs off money.
 */
export function romAcknowledged(facts: GuardFacts): GuardResult {
  const { romLow, romHigh, romIssuedAt } = facts.engagement;
  const stale: GuardResult = { ok: false, code: 'rom_not_acknowledged' };
  if (!romIssuedAt) return stale;
  const [latestAcknowledgement] = facts.events
    .filter((event) => event.kind === 'rom_acknowledgement')
    .sort(byDecidedDescending);
  if (!latestAcknowledgement) return stale;
  if (!acknowledgesIssuance(latestAcknowledgement, romIssuedAt)) return stale;
  return matchesCurrentBand(latestAcknowledgement, romLow, romHigh) ? pass : stale;
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
export function asBuiltReconciled(facts: GuardFacts): GuardResult {
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
export function spatialBaseReady(facts: GuardFacts): GuardResult {
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
export function optionsReady(facts: GuardFacts): GuardResult {
  const conceptOptionCount = facts.artifacts.filter(
    (artifact) => artifact.kind === 'concept_option',
  ).length;

  if (conceptOptionCount < 2 || conceptOptionCount > 4) {
    return { ok: false, code: 'concept_options_out_of_range' };
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
export function rendersPresent(facts: GuardFacts): GuardResult {
  const hasApprovedRender = facts.artifacts.some(
    (artifact) => artifact.kind === 'approved_render',
  );
  if (!hasApprovedRender) return { ok: false, code: 'renders_missing' };
  return pass;
}

/**
 * At least one shop drawing is recorded — the gate for `draftReady`
 * (shop_drawings -> boq). Counts ONLY `shop_drawing` artifacts (a render or BOQ
 * in the bundle never counts). Fails closed with `shop_drawings_missing` when
 * none is present.
 */
export function shopDrawingsPresent(facts: GuardFacts): GuardResult {
  const hasShopDrawing = facts.artifacts.some(
    (artifact) => artifact.kind === 'shop_drawing',
  );
  if (!hasShopDrawing) return { ok: false, code: 'shop_drawings_missing' };
  return pass;
}

/**
 * The bill of quantities is recorded — the gate for `finalizeBOQ`
 * (boq -> execution_decision). Counts ONLY `boq` artifacts. Fails closed with
 * `boq_missing` when none is present.
 */
export function boqPresent(facts: GuardFacts): GuardResult {
  const hasBoq = facts.artifacts.some((artifact) => artifact.kind === 'boq');
  if (!hasBoq) return { ok: false, code: 'boq_missing' };
  return pass;
}

/**
 * The recipient has acknowledged the design-only handoff — the gate for
 * `recipientAcknowledges` (design_only_handoff -> closed_design_only). ANY actor
 * channel satisfies it (the romAcknowledged pattern): the client's own token-path
 * ack (`acknowledge_handoff`) and the staff-recorded ack both append one
 * `handoff_acknowledgement` event. Fails closed with `handoff_not_acknowledged`
 * when none is present.
 */
export function handoffAcknowledged(facts: GuardFacts): GuardResult {
  return facts.events.some((event) => event.kind === 'handoff_acknowledgement')
    ? pass
    : { ok: false, code: 'handoff_not_acknowledged' };
}

/**
 * The as-built drawings are due — the gate for the Gate-B as-built attestations
 * (`flagAsBuiltVariance`, `attestAsBuiltClean`). `as_built_due` is set true at
 * `confirmAndPayDeposit` for an Off-Plan engagement; a non-Off-Plan engagement
 * never becomes due, so it cannot flag a variance or attest a clean as-built.
 * Fails closed with `as_built_not_due` when the drawings are not (yet) due.
 */
export function asBuiltDueOpen(facts: GuardFacts): GuardResult {
  return facts.engagement.asBuiltDue === true
    ? pass
    : { ok: false, code: 'as_built_not_due' };
}

/**
 * Fail-closed sentinel for triggers whose real guard belongs to a later step.
 * It always denies with `transition_not_yet_enabled`, so a declared-but-unwired
 * transition can never fire early. Replaced by concrete guards in later steps.
 */
export function pendingGuard(): GuardResult {
  return { ok: false, code: 'transition_not_yet_enabled' };
}
