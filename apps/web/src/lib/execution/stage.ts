// The execution stage of a delivery, DERIVED from facts and never stored (plan
// A21): the design machine ends at `execution`, and everything after it hangs
// off the BOQ contract. PURE and CLIENT-SAFE, so the cockpit card and its test
// read one rule.
//
// Each live stage has exactly one next action, and it is never one the server
// would refuse: `prepare_final_account` only appears when the final account
// core would accept it (balance > 0, no open change order, none issued yet).
// A contract is settled only when nothing is owed either way: no unpaid
// request, no pending claim, no open change order and no balance left to bill.
// Settled has no next action, except a refund the studio owes an over-billed
// client (credit notes are out of scope; this only surfaces it).
import type { ContractStatus } from '@metra/db';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';

export const EXECUTION_STAGES = [
  'no_boq',
  'no_contract',
  'draft',
  'awaiting_signature',
  'in_progress',
  'final_account',
  'settled',
  'terminated',
] as const;

export type ExecutionStage = (typeof EXECUTION_STAGES)[number];

export const EXECUTION_NEXT_ACTION_KINDS = [
  'open_boq',
  'create_contract',
  'set_schedule',
  'send_contract',
  'record_signed_offline',
  'review_payment_claim',
  'send_milestone_request',
  'send_variation_request',
  'record_payment',
  'await_variation_answer',
  'prepare_final_account',
  'refund_due',
] as const;

export type ExecutionNextActionKind = (typeof EXECUTION_NEXT_ACTION_KINDS)[number];

/** The one thing to do next; a refund carries what the studio owes the client. */
export type ExecutionNextAction =
  | { kind: Exclude<ExecutionNextActionKind, 'refund_due'> }
  | { kind: 'refund_due'; amount: string };

/** What the cockpit knows about the delivery's BOQ contract. */
export interface ExecutionContractFacts {
  status: ContractStatus;
  /** The draft schedule passes `validateSchedule`. */
  scheduleValid: boolean;
  /** The first schedule row with no issued request, if any. */
  nextUnbilledMilestoneId: string | null;
  pendingClaimCount: number;
  /** Approved change orders that add money and have no issued request. */
  unbilledVariationCount: number;
  /** What is still due on the issued final account request; null when none is issued. */
  finalAccountOutstanding: string | null;
  /** Issued requests with something still due on them (the final account one included). */
  unpaidRequestCount: number;
  /** Change orders still awaiting a decision (internal_approved or issued). */
  openVariationCount: number;
  /** `computeFinalAccount(...).balance`: what a final account would still bill. */
  finalAccountBalance: string;
}

export interface ExecutionFacts {
  /** The delivery has an issued, structured BOQ. */
  hasIssuedBoq: boolean;
  contract: ExecutionContractFacts | null;
}

export interface ExecutionStageResult {
  stage: ExecutionStage;
  next: ExecutionNextAction | null;
}

function step(stage: ExecutionStage, kind: Exclude<ExecutionNextActionKind, 'refund_due'>): ExecutionStageResult {
  return { stage, next: { kind } };
}

/** Nothing is owed by the client; a negative balance is a refund owed to them. */
function settled(contract: ExecutionContractFacts): ExecutionStageResult {
  const balance4 = parseMoney4(contract.finalAccountBalance);
  if (balance4 >= 0n) return { stage: 'settled', next: null };
  return { stage: 'settled', next: { kind: 'refund_due', amount: formatMoney4(-balance4) } };
}

/** No final account request yet: claims first, then billing, then waiting, then the final account. */
function inProgress(contract: ExecutionContractFacts): ExecutionStageResult {
  if (contract.pendingClaimCount > 0) return step('in_progress', 'review_payment_claim');
  if (contract.nextUnbilledMilestoneId !== null) return step('in_progress', 'send_milestone_request');
  if (contract.unbilledVariationCount > 0) return step('in_progress', 'send_variation_request');
  if (contract.unpaidRequestCount > 0) return step('in_progress', 'record_payment');
  if (contract.openVariationCount > 0) return step('in_progress', 'await_variation_answer');
  if (parseMoney4(contract.finalAccountBalance) > 0n) return step('in_progress', 'prepare_final_account');
  return settled(contract);
}

/** The final account request is issued: settled only once every request and claim is cleared. */
function finalAccount(contract: ExecutionContractFacts, outstanding: string): ExecutionStageResult {
  if (contract.pendingClaimCount > 0) return step('final_account', 'review_payment_claim');
  if (parseMoney4(outstanding) > 0n || contract.unpaidRequestCount > 0) {
    return step('final_account', 'record_payment');
  }
  // Not reachable through the cores (a final account refuses open orders), but
  // settled must never be said while one waits.
  if (contract.openVariationCount > 0) return step('final_account', 'await_variation_answer');
  return settled(contract);
}

export function executionStage(facts: ExecutionFacts): ExecutionStageResult {
  const { contract } = facts;
  if (contract === null) {
    return facts.hasIssuedBoq ? step('no_contract', 'create_contract') : step('no_boq', 'open_boq');
  }
  switch (contract.status) {
    case 'terminated':
      return { stage: 'terminated', next: null };
    case 'draft':
      return step('draft', contract.scheduleValid ? 'send_contract' : 'set_schedule');
    case 'issued':
      return step('awaiting_signature', 'record_signed_offline');
    case 'signed':
      return contract.finalAccountOutstanding === null
        ? inProgress(contract)
        : finalAccount(contract, contract.finalAccountOutstanding);
  }
}
