// What the concept picker shows after an action answered. PURE (no React, no
// server code): the picker renders it, a unit test pins it.
import type { ConceptChoiceOutcome } from '@/lib/engagements/concept-choice-outcome';
import { portalErrorKey, type PortalErrorKey } from '@/lib/engagements/portal-error-key';
import type { DeliveryActResult } from '../actions';
import type { HeroOutcome } from './hero-confirmed';

/** The confirmation card: what was recorded, and the SAVED letter when there is one. */
export interface PickerConfirmed {
  outcome: HeroOutcome;
  studioNotified: boolean;
  chosenLetter?: string;
}

/** A portal error, `changed` (the letters moved) or `movedOn` (the review closed). */
export type PickerError = PortalErrorKey | 'changed' | 'movedOn';

export type PickerAnswer =
  | { confirmed: PickerConfirmed }
  | { error: PickerError; refresh: boolean };

/** The answer to "Choose this option": only a SAVED letter is ever named. */
export function answerOfChoice(outcome: ConceptChoiceOutcome): PickerAnswer {
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

/** The answer to "Request changes" (the respond verb), as the plain hero gives it. */
export function answerOfChangeRequest(result: DeliveryActResult): PickerAnswer {
  return result.ok
    ? { confirmed: { outcome: 'changes', studioNotified: result.studioNotified === true } }
    : { error: portalErrorKey(result.error), refresh: false };
}
