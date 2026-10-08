// What an actionable hero shows after a client action answered. PURE (no React,
// no server code): the concept picker and the plain action hero render it, a
// unit test pins it.
import type { ConceptChoiceOutcome } from '@/lib/engagements/concept-choice-outcome';
import { portalErrorKey, type PortalErrorKey } from '@/lib/engagements/portal-error-key';
import type { DeliveryActResult } from '../actions';
import type { HeroOutcome } from './hero-confirmed';

/** The confirmation card: what was recorded, and the SAVED letter when there is one. */
export interface HeroConfirmedState {
  outcome: HeroOutcome;
  studioNotified: boolean;
  chosenLetter?: string;
}

/** A portal error, `changed` (the letters moved) or `movedOn` (the review closed). */
export type HeroError = PortalErrorKey | 'changed' | 'movedOn';

export type HeroAnswer =
  | { confirmed: HeroConfirmedState }
  | { error: HeroError; refresh: boolean };

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
    case 'moved_on':
      return { error: 'movedOn', refresh: true };
    case 'error':
      return { error: outcome.error, refresh: false };
  }
}

/** The answer to a design or handover action: the tapped verb, as recorded. */
export function answerOfSignal(result: DeliveryActResult, outcome: HeroOutcome): HeroAnswer {
  return result.ok
    ? { confirmed: { outcome, studioNotified: result.studioNotified === true } }
    : { error: portalErrorKey(result.error), refresh: false };
}
