// The CLIENT REVIEW rule: at the two review stages, has the client answered the
// round in front of them? PURE and CLIENT-SAFE (no db, no server-only), so the gate
// preview, the cockpit, the deliveries list and the dashboard all read one rule.
//
// ADVISORY, NOT A GUARD. The approval stays the studio's call (decision 4): this
// only decides whether the card says "waiting for the client" instead of offering
// Advance. The studio can still record an approval it took offline.
import type { EngagementEventKind } from '@metra/db';
import { isClientGenerated } from './event-provenance';
import type { DesignState } from './states';

/** The two client decisions that answer each review stage. */
export const CLIENT_REVIEW_KINDS = {
  concept_review: ['concept_approval', 'concept_change_request'],
  final_approval: ['design_approval', 'design_change_request'],
} as const satisfies Partial<Record<DesignState, readonly EngagementEventKind[]>>;

type ReviewState = keyof typeof CLIENT_REVIEW_KINDS;

/** The columns of an event this rule reads. */
export interface ClientReviewEvent {
  id: string;
  kind: EngagementEventKind;
  actorChannel: string;
  acknowledgedIssueAt: Date | null;
  decidedAt: Date;
  chosenArtifactId?: string | null;
  /** The letter position SAVED with a concept choice (0057), 1 = A to 4 = D. */
  chosenPosition?: number | null;
}

export interface ClientReviewInput {
  state: DesignState;
  /** `design_engagements.renders_ready_at`: the render issuance under review. */
  rendersReadyAt: Date | null;
  /** LIVE events only (`liveEvents()`): a retracted decision answers nothing. */
  events: readonly ClientReviewEvent[];
}

/** One of the two stages where the client reviews (concept_review, final_approval). */
export function isClientReviewState(state: DesignState): state is ReviewState {
  return state in CLIENT_REVIEW_KINDS;
}

/**
 * Does this design decision answer the CURRENT render issuance? A design is
 * re-approved after every revision, and each `rendersReady` re-stamps
 * `renders_ready_at`, so the decision must be about this round.
 * - Stamped with the issuance: it answers the round it names.
 * - Legacy (no stamp): it answers the current round when it was made after it.
 * - No issuance recorded at all (legacy delivery): one decision per delivery.
 */
function answersCurrentDesignRound(event: ClientReviewEvent, rendersReadyAt: Date | null): boolean {
  if (rendersReadyAt === null) return true;
  if (event.acknowledgedIssueAt !== null) {
    return event.acknowledgedIssueAt.getTime() === rendersReadyAt.getTime();
  }
  return event.decidedAt.getTime() >= rendersReadyAt.getTime();
}

/**
 * The live CLIENT decision answering the current round, newest by `decidedAt`,
 * or null. `concept_review`: any client event of the pair. `final_approval`: a
 * client event of the pair that answers the current render issuance. Any other
 * state: null.
 */
export function currentRoundClientDecision(input: ClientReviewInput): ClientReviewEvent | null {
  if (!isClientReviewState(input.state)) return null;
  const kinds: readonly EngagementEventKind[] = CLIENT_REVIEW_KINDS[input.state];
  const answers = input.events.filter(
    (event) =>
      isClientGenerated(event.actorChannel) &&
      kinds.includes(event.kind) &&
      (input.state === 'concept_review' ||
        answersCurrentDesignRound(event, input.rendersReadyAt)),
  );
  if (answers.length === 0) return null;
  return answers.reduce((newest, event) =>
    event.decidedAt.getTime() > newest.decidedAt.getTime() ? event : newest,
  );
}

/** At a review stage, and the client has not answered the current round yet. */
export function isAwaitingClientReview(input: ClientReviewInput): boolean {
  return isClientReviewState(input.state) && currentRoundClientDecision(input) === null;
}
