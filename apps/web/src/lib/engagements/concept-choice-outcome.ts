// What the portal tells a client who tapped "Choose this option" (Round B, B12).
// PURE and CLIENT-SAFE: the server action computes it, the picker renders it.
//
// THE RULE (F1): the portal only ever names a letter that is SAVED. A first `ok`
// saved the tapped letter, so it may be named. An `already` saved nothing: the
// client (in another tab, or by tapping twice) had already decided, so the
// answer is the decision on file, read back from the snapshot, which may be a
// different option, a plain approval or a request for changes. A `wrong_state`
// is either a letter that moved under the client (the options changed) or a
// review that is no longer open (the step moved on).
import type { PortalErrorKey } from './portal-error-key';
import type { ConceptLetter } from './concept-letter';
import type { PublicDelivery } from './public/types';

export type ConceptChoiceOutcome =
  | { kind: 'chosen'; letter: ConceptLetter; studioNotified: boolean }
  | { kind: 'approved'; studioNotified: boolean }
  | { kind: 'changes_requested'; studioNotified: boolean }
  | { kind: 'options_changed' }
  | { kind: 'moved_on' }
  | { kind: 'error'; error: PortalErrorKey };

/** The part of the re-read snapshot the outcome is decided from. */
export type SavedConcept = Pick<PublicDelivery, 'clientActions' | 'conceptChoice' | 'conceptDecision'>;

/** A decision on file, as the act whose notification it is. */
export type SavedConceptAct = 'concept_chosen' | 'concept_approved' | 'concept_changes_requested';

export const ACT_OF_DECISION = {
  chosen: 'concept_chosen',
  approved: 'concept_approved',
  changes_requested: 'concept_changes_requested',
} as const satisfies Record<NonNullable<PublicDelivery['conceptDecision']>, SavedConceptAct>;

/**
 * After an `already`: the decision on file, or `moved_on` when none is (a
 * retracted decision still holds the slot, or the snapshot could not be read).
 * A choice whose letter cannot be read is reported as a plain approval: true,
 * and it names no letter.
 */
export function outcomeOfSavedDecision(
  saved: SavedConcept | null,
  studioNotified: boolean,
): ConceptChoiceOutcome {
  switch (saved?.conceptDecision) {
    case 'chosen':
      return saved.conceptChoice
        ? { kind: 'chosen', letter: saved.conceptChoice.letter, studioNotified }
        : { kind: 'approved', studioNotified };
    case 'approved':
      return { kind: 'approved', studioNotified };
    case 'changes_requested':
      return { kind: 'changes_requested', studioNotified };
    default:
      return { kind: 'moved_on' };
  }
}

/** After a `wrong_state`: the options changed while the choice is still open, else the step moved on. */
export function outcomeOfRefusedLetter(saved: SavedConcept | null): ConceptChoiceOutcome {
  return saved?.clientActions.includes('approve_concept') ? { kind: 'options_changed' } : { kind: 'moved_on' };
}
