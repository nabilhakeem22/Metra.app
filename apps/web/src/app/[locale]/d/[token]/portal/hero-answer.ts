// What an actionable hero shows after a client action answered. PURE (no React,
// no server code): the concept picker and the plain action hero render it, a
// unit test pins it. Every answer confirms only a decision that is SAVED; a
// step that moved on reads the same for every hero (`movedOn`) and re-reads the
// page.
import type { ConceptChoiceOutcome } from '@/lib/engagements/concept-choice-outcome';
import type { PortalErrorKey } from '@/lib/engagements/portal-error-key';
import type { DesignOutcome, HandoverOutcome } from '@/lib/engagements/review-outcome';
import type { HeroOutcome } from './hero-confirmed';

/** The confirmation card: what was recorded, and the SAVED letter when there is one. */
export interface HeroConfirmedState {
  outcome: HeroOutcome;
  studioNotified: boolean;
  chosenLetter?: string;
  /** A design approval that also acknowledged the budget range (one confirmation). */
  budgetAcknowledged?: boolean;
}

/** A portal error, `changed` (the concept letters moved), `reviewChanged` (what the
 *  client saw is not what is on file now) or `movedOn` (the review closed). */
export type HeroError = PortalErrorKey | 'changed' | 'reviewChanged' | 'movedOn';

export type HeroAnswer =
  | { confirmed: HeroConfirmedState }
  | { error: HeroError; refresh: boolean };

const MOVED_ON: HeroAnswer = { error: 'movedOn', refresh: true };
const REVIEW_CHANGED: HeroAnswer = { error: 'reviewChanged', refresh: true };

/**
 * The answer to a concept-review action (choose, approve, request changes): it
 * confirms only a decision that is SAVED, so a repeat shows the one on file.
 */
export function answerOfConceptOutcome(outcome: ConceptChoiceOutcome): HeroAnswer {
  switch (outcome.kind) {
    case 'chosen':
      return {
        confirmed: { outcome: 'approved', studioNotified: outcome.studioNotified, chosenLetter: outcome.letter },
      };
    case 'approved':
      return { confirmed: { outcome: 'approved', studioNotified: outcome.studioNotified } };
    case 'changes_requested':
      return { confirmed: { outcome: 'changes', studioNotified: outcome.studioNotified } };
    case 'options_changed':
      return { error: 'changed', refresh: true };
    case 'changed':
      return REVIEW_CHANGED;
    case 'moved_on':
      return MOVED_ON;
    case 'error':
      return { error: outcome.error, refresh: false };
  }
}

/** The answer to a final-design action: the decision SAVED, which a stale tab may not have tapped. */
export function answerOfDesignOutcome(outcome: DesignOutcome): HeroAnswer {
  switch (outcome.kind) {
    case 'approved':
      return {
        confirmed: {
          outcome: 'approved',
          studioNotified: outcome.studioNotified,
          ...(outcome.budgetAcknowledged ? { budgetAcknowledged: true } : {}),
        },
      };
    case 'changes_requested':
      return { confirmed: { outcome: 'changes', studioNotified: outcome.studioNotified } };
    case 'changed':
      return REVIEW_CHANGED;
    case 'moved_on':
      return MOVED_ON;
    case 'error':
      return { error: outcome.error, refresh: false };
  }
}

/** The answer to the handover confirmation: confirmed while one is on file. */
export function answerOfHandoverOutcome(outcome: HandoverOutcome): HeroAnswer {
  switch (outcome.kind) {
    case 'acknowledged':
      return { confirmed: { outcome: 'acknowledged', studioNotified: outcome.studioNotified } };
    case 'changed':
      return REVIEW_CHANGED;
    case 'moved_on':
      return MOVED_ON;
    case 'error':
      return { error: outcome.error, refresh: false };
  }
}
