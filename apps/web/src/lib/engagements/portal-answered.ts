// What the client already answered at a review stage. PURE and CLIENT-SAFE.
//
// At a review stage (the concept, the final design, the handover) the server
// offers the stage's verbs only until a client decision of that stage is on file
// (40-delivery-read.sql `client_actions`). So "the stage is a review stage, and
// none of its verbs is offered any more" means the client has answered, and the
// calm hero must say so rather than repeat the stage's "ready for your approval".
// For the concept the snapshot also says WHICH answer is on file.
import type { ConceptLetter } from './concept-letter';
import type { PortalStageKey } from './portal-stage';

export type AnsweredReview =
  | { kind: 'conceptChosen'; letter: ConceptLetter }
  | { kind: 'conceptApproved' }
  | { kind: 'conceptChanges' }
  | { kind: 'handoverReceived' }
  | { kind: 'responded' };

/** The verbs each review stage offers while the client has not answered it. */
const REVIEW_VERBS: Partial<Record<PortalStageKey, readonly string[]>> = {
  conceptReview: ['approve_concept', 'request_concept_changes'],
  finalApproval: ['approve_design', 'request_design_changes'],
  handover: ['acknowledge_handoff'],
};

export interface AnsweredReviewInput {
  stageKey: PortalStageKey;
  clientActions: readonly string[];
  conceptDecision: 'chosen' | 'approved' | 'changes_requested' | null;
  conceptChoice: { letter: ConceptLetter } | null;
}

/** The client's answer at the current review stage, or null when none is on file
 *  (or the stage is not a review stage). */
export function answeredReview(input: AnsweredReviewInput): AnsweredReview | null {
  const verbs = REVIEW_VERBS[input.stageKey];
  if (!verbs || verbs.some((verb) => input.clientActions.includes(verb))) return null;
  if (input.stageKey === 'handover') return { kind: 'handoverReceived' };
  if (input.stageKey === 'conceptReview') {
    if (input.conceptDecision === 'chosen' && input.conceptChoice) {
      return { kind: 'conceptChosen', letter: input.conceptChoice.letter };
    }
    if (input.conceptDecision === 'approved') return { kind: 'conceptApproved' };
    if (input.conceptDecision === 'changes_requested') return { kind: 'conceptChanges' };
  }
  return { kind: 'responded' };
}
