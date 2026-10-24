// Where a delivery is in the EXECUTION phase, for the studio. PURE and
// CLIENT-SAFE. The step is the contract stage's (./execution-facts.ts), the
// same the client is shown; whose move it is follows the one next action
// `executionStage()` derives. The actor table is a total `Record`, so a new
// next action does not compile until it is given an actor here.
import type { ExecutionNextActionKind } from '@/lib/execution/stage';
import type { ExecutionStepKey } from '../phases/execution';
import type { Actor, StepLocation } from '../types';
import { executionPosition, internalChangeOrderCount, type ExecutionFlowFacts } from './execution-facts';

const studio = (): Actor => 'studio';
const client = (): Actor => 'client';

/**
 * Who the next action waits on. The client holds the move while the job waits
 * for their signature, their payment or their answer to a change order; the
 * studio can still act on each (sign on paper, record the payment), but the
 * thing that moves the job is the client's (D1). Two of those waits are the
 * studio's after all: once the online signing window has closed only a paper
 * signature can move the job, and a change order approved internally has to be
 * issued before the client can answer it. Everything else is the studio's.
 */
const NEXT_ACTION_ACTOR: Readonly<Record<ExecutionNextActionKind, (facts: ExecutionFlowFacts) => Actor>> = {
  open_boq: studio,
  create_contract: studio,
  set_schedule: studio,
  send_contract: studio,
  record_signed_offline: (facts) => (facts.signingOpen ? 'client' : 'studio'),
  review_payment_claim: studio,
  send_milestone_request: studio,
  send_variation_request: studio,
  record_payment: client,
  await_variation_answer: (facts) => (internalChangeOrderCount(facts) > 0 ? 'studio' : 'client'),
  prepare_final_account: studio,
  review_final_account: studio,
};

export function locateExecutionForStudio(facts: ExecutionFlowFacts): StepLocation<ExecutionStepKey> {
  const { result, step, status } = executionPosition(facts);
  const whoseMove = result.next ? NEXT_ACTION_ACTOR[result.next.kind](facts) : null;
  return { step, whoseMove, status };
}
