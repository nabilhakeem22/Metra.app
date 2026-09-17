// Design-Engagement Machine — ARTIFACT readiness (Step 2, widened in Steps 5/12
// and the tail wiring; split out of `guards/readiness.ts` in wave 4). PURE and
// CLIENT-SAFE: the five gates that ask "has the deliverable been recorded?" —
// survey/CAD, concept options, renders, shop drawings, BOQ. Their only dependency
// is the erased `@metra/db` artifact type.
import type { EngagementArtifact } from '@metra/db';
import { pass, type GuardFacts, type GuardResult } from './facts';

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
