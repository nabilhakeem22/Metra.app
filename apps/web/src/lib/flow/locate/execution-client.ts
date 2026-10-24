// Where a delivery is in the EXECUTION phase, for the client. PURE and
// CLIENT-SAFE. It reads the SAME facts as the studio's locator, and the step
// and status are the contract stage's (./execution-facts.ts), so the client's
// rail always stands where the studio's does. What differs is the reason the
// client is told and whose move it is: within a stage, the client's own
// decisions first, then what they owe, then what the studio is checking.
import type { ExecutionStage } from '@/lib/execution/stage';
import type { ExecutionStepKey } from '../phases/execution';
import type { Actor, StepLocation } from '../types';
import { executionPosition, type ExecutionFlowFacts } from './execution-facts';

export const CLIENT_EXECUTION_REASONS = [
  'preparing_contract',
  'sign_contract',
  'signing_closed',
  'decide_change_order',
  'pay_request',
  'payment_being_confirmed',
  'works_in_progress',
  'final_account_due',
  'final_account_in_review',
  'settled',
  'terminated',
] as const;

export type ClientExecutionReason = (typeof CLIENT_EXECUTION_REASONS)[number];

export type ClientExecutionLocation = StepLocation<ExecutionStepKey> & { reason: ClientExecutionReason };

/** Who holds the move for each reason; null once the phase has ended. */
const REASON_MOVE: Readonly<Record<ClientExecutionReason, Actor | null>> = {
  preparing_contract: 'studio',
  sign_contract: 'client',
  signing_closed: 'studio',
  decide_change_order: 'client',
  pay_request: 'client',
  payment_being_confirmed: 'studio',
  works_in_progress: 'site',
  final_account_due: 'client',
  final_account_in_review: 'studio',
  settled: null,
  terminated: null,
};

/**
 * A signed contract, from the client's side: a change order issued to them,
 * then anything due they have not claimed (`due`), then a claim the studio is
 * checking; with none of those, the stage's own news (`otherwise`).
 */
function signedReason(
  facts: ExecutionFlowFacts,
  due: ClientExecutionReason,
  otherwise: ClientExecutionReason,
): ClientExecutionReason {
  if (facts.issuedChangeOrderCount > 0) return 'decide_change_order';
  if (facts.unclaimedDueRequestCount > 0) return due;
  if ((facts.stage.contract?.pendingClaimCount ?? 0) > 0) return 'payment_being_confirmed';
  return otherwise;
}

/**
 * Total over the stages, so a new stage does not compile until the client is
 * given a reason for it. Before the contract is issued the client sees only
 * that it is being prepared. Once the final account is issued, whatever is
 * still due, an older milestone included, is the final account's remainder.
 */
const STAGE_REASON: Readonly<Record<ExecutionStage, (facts: ExecutionFlowFacts) => ClientExecutionReason>> = {
  no_boq: () => 'preparing_contract',
  no_contract: () => 'preparing_contract',
  draft: () => 'preparing_contract',
  awaiting_signature: (facts) => (facts.signingOpen ? 'sign_contract' : 'signing_closed'),
  in_progress: (facts) => signedReason(facts, 'pay_request', 'works_in_progress'),
  final_account: (facts) => signedReason(facts, 'final_account_due', 'final_account_in_review'),
  settled: () => 'settled',
  terminated: () => 'terminated',
};

export function locateExecutionForClient(facts: ExecutionFlowFacts): ClientExecutionLocation {
  const { result, step, status } = executionPosition(facts);
  const reason = STAGE_REASON[result.stage](facts);
  return { step, whoseMove: REASON_MOVE[reason], status, reason };
}
