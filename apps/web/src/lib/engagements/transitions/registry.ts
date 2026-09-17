// Design-Engagement Machine — transition registry (Step 2, tail wired, 3D
// revision loop wired). PURE, CLIENT-SAFE DATA: the whole shape of the machine,
// composed from the six edge files under `./edges`. A trigger is filed by the
// PHASE OF ITS SOURCE STATE (the five `PhaseKey`s in phases.ts), plus one
// off-ramp file for `abandon`, which leaves every non-terminal state at once.
// The machine already had that cohesion axis — with a compile-time drift guard
// on it — so the split follows it rather than inventing a second grouping.
import { CONCEPT_LAYOUT_EDGES } from './edges/concept-layout';
import { DOCUMENTATION_BOQ_EDGES } from './edges/documentation-boq';
import { HANDOFF_EXECUTION_EDGES } from './edges/handoff-execution';
import { OFF_RAMP_EDGES } from './edges/off-ramp';
import { PROPOSAL_SURVEY_EDGES } from './edges/proposal-survey';
import { THREED_APPROVAL_EDGES } from './edges/threed-approvals';
import type { TransitionDef, Trigger } from './types';

/**
 * The registry. All 19 triggers are wired: the happy path runs created -> … ->
 * execution / closed_design_only, `abandon` is the guard-less off-ramp,
 * `rejectDesign` bounces the design back to negotiation, and
 * `designChangeRaised` sends the 3D back for a revision.
 *
 * THE ANNOTATION IS THE EXHAUSTIVENESS CHECK. `Record<Trigger, TransitionDef>`
 * means a trigger declared in `types.ts` and filed in no edge file does not
 * compile, and a trigger filed in two of them is a duplicate-key lint error.
 * That is what the hand-kept "which triggers are wired" set used to assert at
 * runtime, and it is why this wave deleted it: it could never be false.
 *
 * THE SPREAD ORDER IS A VISIBLE PROPERTY, not a formatting choice. `Object.keys`
 * of this object is what `legalTriggersFrom` returns, and that list is the order
 * the engagement's next-action buttons are rendered in. Documentation is spread
 * BEFORE the 3D approvals for exactly that reason: `designChangeRaised` is filed
 * with the 3D edges (its home phase) but is also legal from `shop_drawings`,
 * where the forward action is `draftReady` — and grouping it earlier silently
 * moved it in front. Measured: with documentation first, all 16 states return
 * the same trigger order they returned before the split, which
 * `ui.test.ts` now pins state by state.
 */
export const TRANSITIONS: Record<Trigger, TransitionDef> = {
  ...PROPOSAL_SURVEY_EDGES,
  ...CONCEPT_LAYOUT_EDGES,
  ...DOCUMENTATION_BOQ_EDGES,
  ...THREED_APPROVAL_EDGES,
  ...HANDOFF_EXECUTION_EDGES,
  ...OFF_RAMP_EDGES,
};
