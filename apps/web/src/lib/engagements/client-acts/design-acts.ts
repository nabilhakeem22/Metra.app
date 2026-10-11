import 'server-only';
// The client's final-design decisions on the portal (Round C, carry-over 5):
// approve, ask for changes, or approve together with the budget range. Each is
// the write, the studio's notification, and the answer the portal shows
// (../review-outcome.ts). When the write saved nothing (a repeat, a review that
// closed, a delivery that ended), the answer is the decision ON FILE for the
// round the client saw, never the verb a stale tab tapped.
//
// THE ROUND THE CLIENT SAW (Round D): every design write names the render
// issuance of the page it was tapped on, and the seven-argument SDF refuses it
// (`wrong_state`, nothing written) once renders were re-issued. No read comes
// before a write.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { portalErrorKey } from '../portal-error-key';
import { recordDeliveryActionByToken, type DeliveryActionResult } from '../public';
import {
  ACT_OF_DESIGN_DECISION,
  OUTCOME_OF_DESIGN_VERB,
  answersFromSaved,
  budgetPartOf,
  designOutcomeOfSaved,
  type BudgetPart,
  type DesignOutcome,
  type DesignVerb,
  type DesignWithBudgetOutcome,
} from '../review-outcome';
import type { ReviewSeen } from '../review-seen';
import { acknowledgeBudgetAndNotify } from './budget-acts';
import { withStudioNotified } from './notify';
import { savedDelivery } from './saved-delivery';

type ReviewInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action' | 'expectedIssueAt'>;

/** One design write: the verb, the round the client saw, and whether the same tap's budget half was not saved. */
interface DesignWrite {
  action: DesignVerb;
  roundSeen: string | null;
  budgetPending?: true;
}

/**
 * The design decision on file for the round the client saw, notified through
 * the R3 check (a lost first notification is repaired, a delivered one is not
 * repeated). A decision of ANOTHER round answers nothing: it is not what this
 * tap was about. With nothing on file nobody is notified, and the answer says why.
 */
async function answerFromSavedDesign(rawToken: string, roundSeen: string | null): Promise<DesignOutcome> {
  const saved = await savedDelivery(rawToken);
  const decision = saved !== null && saved.rendersIssuedAt === roundSeen ? saved.designDecision : null;
  if (decision === null) return designOutcomeOfSaved(saved && { stageKey: saved.stageKey, designDecision: null }, false);
  const { studioNotified } = await withStudioNotified(
    rawToken,
    { ok: true, code: 'already' as const },
    { kind: ACT_OF_DESIGN_DECISION[decision.kind] },
  );
  return designOutcomeOfSaved(saved, studioNotified);
}

/** One design write and its answer. */
async function writeDesign(rawToken: string, input: ReviewInput, write: DesignWrite): Promise<DesignOutcome> {
  const result = await recordDeliveryActionByToken(rawToken, {
    ...input,
    action: write.action,
    expectedIssueAt: write.roundSeen,
  });
  if (answersFromSaved(result)) return answerFromSavedDesign(rawToken, write.roundSeen);
  if (!result.ok) return { kind: 'error', error: portalErrorKey(result.error) };
  const decision = OUTCOME_OF_DESIGN_VERB[write.action];
  const act = { kind: ACT_OF_DESIGN_DECISION[decision], ...(write.budgetPending ? { budgetPending: true as const } : {}) };
  const { studioNotified } = await withStudioNotified(rawToken, result, act);
  return { kind: decision, studioNotified };
}

/**
 * Approve the final design or ask for changes, about the render round the
 * client SAW: a round re-issued since then answers `changed` (or `moved_on`)
 * and writes nothing.
 */
export async function respondToDesignAndNotify(
  rawToken: string,
  { action, ...input }: ReviewInput & { action: DesignVerb },
  seen: ReviewSeen,
): Promise<DesignOutcome> {
  return writeDesign(rawToken, input, { action, roundSeen: seen.rendersIssuedAt });
}

/** The budget half: what acknowledge_rom answered, or null when it threw. */
async function acknowledgeBudgetHalf(rawToken: string, input: ReviewInput, romIssuedAt: string): Promise<DeliveryActionResult | null> {
  try {
    return await acknowledgeBudgetAndNotify(rawToken, { ...input, note: null }, romIssuedAt);
  } catch (error) {
    console.error('approve design with budget: the budget half failed', { error: loggableFailure(error) });
    return null;
  }
}

/** The design half's answer; a throw is the generic failure, so the budget part is still reported. */
async function approveDesignHalf(rawToken: string, input: ReviewInput, write: DesignWrite): Promise<DesignOutcome> {
  try {
    return await writeDesign(rawToken, input, write);
  } catch (error) {
    console.error('approve design with budget: the design half failed', { error: loggableFailure(error) });
    return { kind: 'error', error: 'generic' };
  }
}

/** The design answer with the budget part. A design failure after a SAVED budget still says the budget was saved. */
function withBudgetPart(design: DesignOutcome, budget: BudgetPart): DesignWithBudgetOutcome {
  if (design.kind !== 'error') return { ...design, budget };
  return budget === 'acknowledged' ? { kind: 'changed', budget } : design;
}

/**
 * Approve the final design AND acknowledge the budget band from one
 * confirmation (owner decision 2, Round D): TWO consents, two writes, each
 * guarded by its own issuance alone. The budget goes first, so the design's
 * studio notification can say whether the budget still waits.
 * - A band re-issued since the page loaded: the design approval is saved and
 *   the budget answers `changed` (review the new range again).
 * - Renders re-issued but the band the same: the budget acknowledgement alone
 *   is saved; the design answers `changed`.
 * - Both: neither is saved.
 * The two writes and their notifications run as separate statements, NEVER in
 * one transaction: a transaction holding the budget's and the design's
 * notifier locks together deadlocks against the hourly sweep, which takes the
 * same locks (D2 reliability R1; design-acts-transactions.test.ts).
 * A dead or expired link stops after the first write: the second would fail
 * the same way.
 */
export async function approveDesignWithBudgetAndNotify(
  rawToken: string,
  input: ReviewInput,
  seen: ReviewSeen & { romIssuedAt: string },
): Promise<DesignWithBudgetOutcome> {
  const budgetResult = await acknowledgeBudgetHalf(rawToken, input, seen.romIssuedAt);
  if (budgetResult?.error === 'token_invalid' || budgetResult?.error === 'token_expired') {
    return { kind: 'error', error: budgetResult.error };
  }
  const budget = budgetPartOf(budgetResult);
  const design = await approveDesignHalf(rawToken, input, {
    action: 'approve_design',
    roundSeen: seen.rendersIssuedAt,
    ...(budget === 'acknowledged' ? {} : { budgetPending: true as const }),
  });
  return withBudgetPart(design, budget);
}
