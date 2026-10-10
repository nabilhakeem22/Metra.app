import 'server-only';
// The client's final-design decisions on the portal (Round C, carry-over 5):
// approve, ask for changes, or approve together with the budget range. Each is
// a check that the delivery is still what the client saw, the write, the
// studio's notification, and the answer the portal shows (../review-outcome.ts).
// When the write saved nothing (a repeat, a review that closed, a delivery that
// ended), the answer is the decision ON FILE, never the verb a stale tab tapped.
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
import type { ReviewSeen } from '../review-seen';
import { clientActOfVerb } from './acts';
import { acknowledgeBudgetAndNotify } from './budget-acts';
import { withStudioNotified } from './notify';
import { stillAsSeen } from './review-seen-check';
import { savedDelivery } from './saved-delivery';

type ReviewInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action'>;

/**
 * The design decision on file, notified through the R3 check (a lost first
 * notification is repaired, a delivered one is not repeated). With nothing
 * live on file nobody is notified, and the answer says why.
 */
async function answerFromSavedDesign(rawToken: string): Promise<DesignOutcome> {
  const saved = await savedDelivery(rawToken);
  const decision = saved?.designDecision ?? null;
  if (decision === null) return designOutcomeOfSaved(saved, false);
  const { studioNotified } = await withStudioNotified(
    rawToken,
    { ok: true, code: 'already' as const },
    { kind: ACT_OF_DESIGN_DECISION[decision.kind] },
  );
  return designOutcomeOfSaved(saved, studioNotified);
}

/** One design write and its answer. `heldSlot`: the write answered ok or `already` (this round's slot). */
async function writeDesign(
  rawToken: string,
  input: ReviewInput & { action: DesignVerb },
): Promise<{ heldSlot: boolean; outcome: DesignOutcome }> {
  const result = await recordDeliveryActionByToken(rawToken, input);
  if (answersFromSaved(result)) return { heldSlot: result.ok, outcome: await answerFromSavedDesign(rawToken) };
  if (!result.ok) return { heldSlot: false, outcome: { kind: 'error', error: portalErrorKey(result.error) } };
  const { studioNotified } = await withStudioNotified(rawToken, result, clientActOfVerb(input.action));
  return { heldSlot: true, outcome: { kind: OUTCOME_OF_DESIGN_VERB[input.action], studioNotified } };
}

/**
 * Approve the final design or ask for changes, about the render round the
 * client SAW: a round re-issued since then answers `changed` and writes
 * nothing.
 */
export async function respondToDesignAndNotify(
  rawToken: string,
  input: ReviewInput & { action: DesignVerb },
  seen: ReviewSeen,
): Promise<DesignOutcome> {
  if (!(await stillAsSeen(rawToken, { round: seen.round }))) return { kind: 'changed' };
  return (await writeDesign(rawToken, input)).outcome;
}

/**
 * Approve the final design AND acknowledge the budget band, from one
 * confirmation, about the round AND the band the dialog showed (`changed`
 * otherwise, nothing written). The band is acknowledged only when THIS call's
 * design write held the round's slot (ok, or `already` for the same round) and
 * the decision SAVED is an approval; never after a refusal answered from the
 * decision on file. A refused acknowledgement leaves the approval standing and
 * says `budgetAcknowledged: false`; the budget card still offers its button.
 */
export async function approveDesignWithBudgetAndNotify(
  rawToken: string,
  input: ReviewInput,
  seen: ReviewSeen,
): Promise<DesignOutcome> {
  if (seen.band === null || !(await stillAsSeen(rawToken, seen))) return { kind: 'changed' };
  const { heldSlot, outcome } = await writeDesign(rawToken, { ...input, action: 'approve_design' });
  if (!heldSlot || outcome.kind !== 'approved') return outcome;
  const budget = await acknowledgeBudgetAndNotify(rawToken, { ...input, note: null });
  return { ...outcome, budgetAcknowledged: budget.ok };
}
