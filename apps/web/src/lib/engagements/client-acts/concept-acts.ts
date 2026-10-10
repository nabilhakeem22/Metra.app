import 'server-only';
// The client's concept decisions on the portal (Round B, B12): choosing an
// option, approving, asking for changes. Each is the write, the studio's
// notification, and the answer the portal shows (../concept-choice-outcome.ts).
// A write that saved nothing (a repeat, a review the studio has since closed,
// a delivery that ended) is answered from the snapshot read back after it, so
// the portal only ever confirms a decision that is SAVED, never the one a stale
// tap named (fix round F6: the same rule as the design and the handover). A
// choice's `wrong_state` with nothing on file says whether the options changed
// or the step moved on.
import { conceptLetter } from '../concept-letter';
import {
  ACT_OF_DECISION,
  OUTCOME_OF_CONCEPT_VERB,
  outcomeOfRefusedLetter,
  outcomeOfSavedDecision,
  type ConceptChoiceOutcome,
  type ConceptVerb,
  type SavedConcept,
} from '../concept-choice-outcome';
import { portalErrorKey } from '../portal-error-key';
import { chooseConceptByToken, recordDeliveryActionByToken } from '../public';
import { answersFromSaved } from '../review-outcome';
import { clientActOfVerb } from './acts';
import { withStudioNotified } from './notify';
import { savedDelivery } from './saved-delivery';

/**
 * Nothing was saved by THIS tap. Answer the decision on file and notify
 * (through the R3 check) that decision's act; with no live decision on file
 * nobody is notified and the answer says why (../concept-choice-outcome.ts).
 */
async function answerFromSaved(rawToken: string, saved: SavedConcept | null): Promise<ConceptChoiceOutcome> {
  const decision = saved?.conceptDecision ?? null;
  if (decision === null) return outcomeOfSavedDecision(saved, false);
  const { studioNotified } = await withStudioNotified(
    rawToken,
    { ok: true, code: 'already' as const },
    { kind: ACT_OF_DECISION[decision] },
  );
  return outcomeOfSavedDecision(saved, studioNotified);
}

/**
 * Choose, then notify and answer. A first `ok` saved the tapped letter and
 * notifies `concept_chosen`. A `wrong_state` with a decision on file answers
 * that decision; with none, whether the options changed or the step moved on.
 * A `not_active` with a decision on file answers it too. Any other refusal is
 * the portal's error key.
 */
export async function chooseConceptAndNotify(
  rawToken: string,
  input: Parameters<typeof chooseConceptByToken>[1],
): Promise<ConceptChoiceOutcome> {
  const result = await chooseConceptByToken(rawToken, input);
  if (result.ok && result.code === 'already') return answerFromSaved(rawToken, await savedDelivery(rawToken));
  if (!result.ok) {
    if (!answersFromSaved(result)) return { kind: 'error', error: portalErrorKey(result.error) };
    const saved = await savedDelivery(rawToken);
    if (saved?.conceptDecision) return answerFromSaved(rawToken, saved);
    return result.error === 'wrong_state' ? outcomeOfRefusedLetter(saved) : { kind: 'error', error: 'not_active' };
  }
  const { studioNotified } = await withStudioNotified(rawToken, result, { kind: 'concept_chosen' });
  const letter = conceptLetter(input.position);
  return letter ? { kind: 'chosen', letter, studioNotified } : { kind: 'approved', studioNotified };
}

/**
 * Approve the concept or ask for changes (the respond verbs), then notify and
 * answer. A first `ok` confirms the verb; a write that saved nothing confirms
 * the decision on file, which may be a choice, the other verb, or nothing live.
 */
export async function respondToConceptAndNotify(
  rawToken: string,
  input: Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action'> & { action: ConceptVerb },
): Promise<ConceptChoiceOutcome> {
  const result = await recordDeliveryActionByToken(rawToken, input);
  if (answersFromSaved(result)) return answerFromSaved(rawToken, await savedDelivery(rawToken));
  if (!result.ok) return { kind: 'error', error: portalErrorKey(result.error) };
  const { studioNotified } = await withStudioNotified(rawToken, result, clientActOfVerb(input.action));
  return { kind: OUTCOME_OF_CONCEPT_VERB[input.action], studioNotified };
}
