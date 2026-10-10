import 'server-only';
// The client's final-design decisions on the portal (Round C, carry-over 5):
// approve, ask for changes, or approve together with the budget range. Each is
// the write, the studio's notification, and the answer the portal shows
// (../review-outcome.ts). Mirrors ./concept-acts.ts: when the write saved
// nothing (a repeat, a review that closed, a delivery that ended), the answer
// is the decision ON FILE, never the verb a stale tab tapped.
import { portalErrorKey } from '../portal-error-key';
import { recordDeliveryActionByToken } from '../public';
import {
  ACT_OF_DESIGN_DECISION,
  OUTCOME_OF_DESIGN_VERB,
  answersFromSaved,
  designOutcomeOfSaved,
  type DesignOutcome,
  type DesignVerb,
} from '../review-outcome';
import { clientActOfVerb } from './acts';
import { acknowledgeBudgetAndNotify } from './budget-acts';
import { withStudioNotified } from './notify';
import { savedDelivery } from './saved-delivery';

type ReviewInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action'>;

/**
 * The design decision on file, notified through the R3 check (a lost first
 * notification is repaired, a delivered one is not repeated); with nothing
 * live on file the step has moved on and nobody is notified.
 */
async function answerFromSavedDesign(rawToken: string): Promise<DesignOutcome> {
  const saved = await savedDelivery(rawToken);
  const decision = saved?.designDecision ?? null;
  if (decision === null) return { kind: 'moved_on' };
  const { studioNotified } = await withStudioNotified(
    rawToken,
    { ok: true, code: 'already' as const },
    { kind: ACT_OF_DESIGN_DECISION[decision.kind] },
  );
  return designOutcomeOfSaved(saved, studioNotified);
}

/** Approve the final design or ask for changes, then notify and answer. */
export async function respondToDesignAndNotify(
  rawToken: string,
  input: ReviewInput & { action: DesignVerb },
): Promise<DesignOutcome> {
  const result = await recordDeliveryActionByToken(rawToken, input);
  if (answersFromSaved(result)) return answerFromSavedDesign(rawToken);
  if (!result.ok) return { kind: 'error', error: portalErrorKey(result.error) };
  const { studioNotified } = await withStudioNotified(rawToken, result, clientActOfVerb(input.action));
  return { kind: OUTCOME_OF_DESIGN_VERB[input.action], studioNotified };
}

/**
 * Approve the final design AND acknowledge the budget range, from one
 * confirmation. The design write goes first; the budget is acknowledged only
 * when the decision SAVED is an approval (a stale tab whose saved answer is a
 * change request acknowledges nothing). A refused acknowledgement leaves the
 * approval standing, says `budgetAcknowledged: false`, and the budget card
 * still offers its own button.
 */
export async function approveDesignWithBudgetAndNotify(rawToken: string, input: ReviewInput): Promise<DesignOutcome> {
  const outcome = await respondToDesignAndNotify(rawToken, { ...input, action: 'approve_design' });
  if (outcome.kind !== 'approved') return outcome;
  const budget = await acknowledgeBudgetAndNotify(rawToken, { ...input, note: null });
  return { ...outcome, budgetAcknowledged: budget.ok };
}
