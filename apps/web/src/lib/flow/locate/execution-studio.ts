// Where a delivery is in the EXECUTION phase, for the studio. PURE and
// CLIENT-SAFE. The step is the contract stage's (./execution-facts.ts), the
// same the client is shown; whose move it is follows the one next action
// `executionStage()` derives. The holder table is a total `Record`, so a new
// next action does not compile until it is given a holder here.
import type { ExecutionNextActionKind } from '@/lib/execution/stage';
import type { ExecutionStepKey } from '../phases/execution';
import type { Actor, StepLocation } from '../types';
import { executionPosition, internalChangeOrderCount, type ExecutionFlowFacts } from './execution-facts';

/**
 * Why the studio holds a wait that is otherwise the client's: the online
 * signing window has closed, so only a paper signature can move the job; a
 * change order approved internally has to be issued before the client can
 * answer it; or a change order's link has expired, so the client can no longer
 * answer it online.
 */
export const STUDIO_TAKE_BACKS = ['signing_closed', 'change_order_not_issued', 'change_order_link_expired'] as const;

export type StudioTakeBack = (typeof STUDIO_TAKE_BACKS)[number];

/** The studio's location, and why it holds a client's wait when it does; null otherwise. */
export type StudioExecutionLocation = StepLocation<ExecutionStepKey> & { takenBack: StudioTakeBack | null };

interface Holder {
  actor: Actor;
  takenBack: StudioTakeBack | null;
}

const studio = (): Holder => ({ actor: 'studio', takenBack: null });
const client = (): Holder => ({ actor: 'client', takenBack: null });
const takenBack = (why: StudioTakeBack): Holder => ({ actor: 'studio', takenBack: why });

/** A change order the client cannot answer is the studio's: one still to issue first, then one whose link expired. */
function changeOrderHolder(facts: ExecutionFlowFacts): Holder {
  if (internalChangeOrderCount(facts) > 0) return takenBack('change_order_not_issued');
  if (facts.expiredChangeOrderCount > 0) return takenBack('change_order_link_expired');
  return client();
}

/**
 * Who the next action waits on. The client holds the move while the job waits
 * for their signature, their payment or their answer to a change order; the
 * studio can still act on each (sign on paper, record the payment), but the
 * thing that moves the job is the client's (D1). A wait the client cannot
 * answer online is taken back by the studio (`STUDIO_TAKE_BACKS`). Everything
 * else is the studio's.
 */
const NEXT_ACTION_HOLDER: Readonly<Record<ExecutionNextActionKind, (facts: ExecutionFlowFacts) => Holder>> = {
  open_boq: studio,
  create_contract: studio,
  set_schedule: studio,
  send_contract: studio,
  record_signed_offline: (facts) => (facts.signingOpen ? client() : takenBack('signing_closed')),
  review_payment_claim: studio,
  send_milestone_request: studio,
  send_variation_request: studio,
  record_payment: client,
  await_variation_answer: changeOrderHolder,
  prepare_final_account: studio,
  review_final_account: studio,
};

export function locateExecutionForStudio(facts: ExecutionFlowFacts): StudioExecutionLocation {
  const { result, step, status } = executionPosition(facts);
  if (!result.next) return { step, whoseMove: null, status, takenBack: null };
  const holder = NEXT_ACTION_HOLDER[result.next.kind](facts);
  return { step, whoseMove: holder.actor, status, takenBack: holder.takenBack };
}
