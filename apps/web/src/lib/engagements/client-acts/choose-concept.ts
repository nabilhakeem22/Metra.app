import 'server-only';
// The client chooses a concept option (Round B, B12): the write, the studio's
// notification, and the answer the portal shows (../concept-choice-outcome.ts).
// An `already` or a `wrong_state` is answered from the snapshot read back after
// the write, so the portal never names a letter that was not saved.
import { conceptLetter } from '../concept-letter';
import {
  ACT_OF_DECISION,
  outcomeOfRefusedLetter,
  outcomeOfSavedDecision,
  type ConceptChoiceOutcome,
  type SavedConcept,
} from '../concept-choice-outcome';
import { portalErrorKey } from '../portal-error-key';
import { chooseConceptByToken, getDeliveryByToken } from '../public';
import { withStudioNotified } from './notify';

/** The decision on file through the client's own token, or null when unreadable. */
async function savedConcept(rawToken: string): Promise<SavedConcept | null> {
  const read = await getDeliveryByToken(rawToken);
  return read.status === 'ok' ? read.delivery : null;
}

/**
 * Choose, then notify and answer. A first `ok` saved the tapped letter and
 * notifies `concept_chosen`. An `already` notifies (through the R3 check) the
 * decision ACTUALLY on file, not the one this tap named, and answers it. A
 * `wrong_state` says whether the options changed or the step moved on. Any
 * other refusal is the portal's error key.
 */
export async function chooseConceptAndNotify(
  rawToken: string,
  input: Parameters<typeof chooseConceptByToken>[1],
): Promise<ConceptChoiceOutcome> {
  const result = await chooseConceptByToken(rawToken, input);
  if (!result.ok) {
    if (result.error !== 'wrong_state') return { kind: 'error', error: portalErrorKey(result.error) };
    return outcomeOfRefusedLetter(await savedConcept(rawToken));
  }
  if (result.code !== 'already') {
    const { studioNotified } = await withStudioNotified(rawToken, result, { kind: 'concept_chosen' });
    const letter = conceptLetter(input.position);
    return letter ? { kind: 'chosen', letter, studioNotified } : { kind: 'approved', studioNotified };
  }
  const saved = await savedConcept(rawToken);
  const decision = saved?.conceptDecision ?? null;
  if (decision === null) return { kind: 'moved_on' };
  const { studioNotified } = await withStudioNotified(rawToken, result, {
    kind: ACT_OF_DECISION[decision],
  });
  return outcomeOfSavedDecision(saved, studioNotified);
}
