// Where a delivery is in the EXECUTION phase, for the studio. PURE and
// CLIENT-SAFE. It reads the stage and the one next action `executionStage()`
// already derives (lib/execution/stage.ts). Both maps are total `Record`s, so a
// new stage or next action does not compile until it is given a step and an
// actor here.
import type { ExecutionNextActionKind, ExecutionStage, ExecutionStageResult } from '@/lib/execution/stage';
import type { ExecutionStepKey } from '../phases/execution';
import type { Actor, PhaseStatus, StepLocation } from '../types';

interface StagePlace {
  step: ExecutionStepKey | null;
  status: PhaseStatus;
}

const active = (step: ExecutionStepKey): StagePlace => ({ step, status: 'active' });

const STAGE_PLACE: Readonly<Record<ExecutionStage, StagePlace>> = {
  no_boq: active('contract'),
  no_contract: active('contract'),
  draft: active('contract'),
  awaiting_signature: active('signature'),
  in_progress: active('works'),
  final_account: active('final_account'),
  settled: { step: 'settled', status: 'complete' },
  terminated: { step: null, status: 'closed' },
};

/**
 * Who the next action waits on. The client holds the move while the job waits
 * for their signature, their payment or their answer to a change order; the
 * studio can still act on each (sign on paper, record the payment), but the
 * thing that moves the job is the client's. Everything else is the studio's.
 */
const NEXT_ACTION_ACTOR: Readonly<Record<ExecutionNextActionKind, Actor>> = {
  open_boq: 'studio',
  create_contract: 'studio',
  set_schedule: 'studio',
  send_contract: 'studio',
  record_signed_offline: 'client',
  review_payment_claim: 'studio',
  send_milestone_request: 'studio',
  send_variation_request: 'studio',
  record_payment: 'client',
  await_variation_answer: 'client',
  prepare_final_account: 'studio',
  review_final_account: 'studio',
};

export function locateExecutionForStudio(result: ExecutionStageResult): StepLocation<ExecutionStepKey> {
  const place = STAGE_PLACE[result.stage];
  const whoseMove = place.status === 'active' && result.next ? NEXT_ACTION_ACTOR[result.next.kind] : null;
  return { step: place.step, whoseMove, status: place.status };
}
