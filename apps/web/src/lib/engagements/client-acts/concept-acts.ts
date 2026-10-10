import 'server-only';
// The client's concept decisions on the portal (Round B, B12): choosing an
// option, approving, asking for changes. Each is the write, the studio's
// notification, and the answer the portal shows (../concept-choice-outcome.ts).
// An `already` is answered from the snapshot read back after the write, so the
// portal only ever confirms a decision that is SAVED, never the one a stale tap
// named; a choice's `wrong_state` says whether the options changed or the step
// moved on.
import { conceptLetter } from '../concept-letter';
import {
  ACT_OF_DECISION,
  OUTCOME_OF_CONCEPT_VERB,
  outcomeOfRefusedLetter,
  outcomeOfSavedDecision,
  type ConceptChoiceOutcome,
  type ConceptVerb,
} from '../concept-choice-outcome';
import { portalErrorKey } from '../portal-error-key';
import { chooseConceptByToken, recordDeliveryActionByToken } from '../public';
import { clientActOfVerb } from './acts';
import { withStudioNotified } from './notify';
import { savedDelivery } from './saved-delivery';

/**
 * A concept write answered `already`: nothing was saved by THIS tap. Answer the
 * decision on file and notify (through the R3 check) that decision's act; with
 * no live decision on file (a retracted one still holds the slot) the step has
 * moved on and nobody is notified.
 */
async function answerRepeat(rawToken: string): Promise<ConceptChoiceOutcome> {
  const saved = await savedDelivery(rawToken);
  const decision = saved?.conceptDecision ?? null;
  if (decision === null) return { kind: 'moved_on' };
  const { studioNotified } = await withStudioNotified(
    rawToken,
    { ok: true, code: 'already' as const },
    { kind: ACT_OF_DECISION[decision] },
  );
  return outcomeOfSavedDecision(saved, studioNotified);
}

/**
 * Choose, then notify and answer. A first `ok` saved the tapped letter and
 * notifies `concept_chosen`. A `wrong_state` says whether the options changed or
 * the step moved on. Any other refusal is the portal's error key.
 */
export async function chooseConceptAndNotify(
  rawToken: string,
  input: Parameters<typeof chooseConceptByToken>[1],
): Promise<ConceptChoiceOutcome> {
  const result = await chooseConceptByToken(rawToken, input);
  if (!result.ok) {
    if (result.error !== 'wrong_state') return { kind: 'error', error: portalErrorKey(result.error) };
    return outcomeOfRefusedLetter(await savedDelivery(rawToken));
  }
  if (result.code === 'already') return answerRepeat(rawToken);
  const { studioNotified } = await withStudioNotified(rawToken, result, { kind: 'concept_chosen' });
  const letter = conceptLetter(input.position);
  return letter ? { kind: 'chosen', letter, studioNotified } : { kind: 'approved', studioNotified };
}

/**
 * Approve the concept or ask for changes (the respond verbs), then notify and
 * answer. A first `ok` confirms the verb; an `already` confirms the decision on
 * file, which may be a choice, the other verb, or nothing live at all.
 */
export async function respondToConceptAndNotify(
  rawToken: string,
  input: Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action'> & { action: ConceptVerb },
): Promise<ConceptChoiceOutcome> {
  const result = await recordDeliveryActionByToken(rawToken, input);
  if (!result.ok) return { kind: 'error', error: portalErrorKey(result.error) };
  if (result.code === 'already') return answerRepeat(rawToken);
  const { studioNotified } = await withStudioNotified(rawToken, result, clientActOfVerb(input.action));
  return { kind: OUTCOME_OF_CONCEPT_VERB[input.action], studioNotified };
}
