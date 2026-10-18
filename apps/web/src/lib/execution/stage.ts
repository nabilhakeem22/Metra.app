// The execution stage of a delivery, DERIVED from facts and never stored (plan
// A21): the design machine ends at `execution`, and everything after it hangs
// off the BOQ contract. PURE and CLIENT-SAFE, so the cockpit card and its test
// read one rule. Each live stage has exactly one next action; a settled or a
// terminated contract has none left.
import type { ContractStatus } from '@metra/db';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';

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

export const EXECUTION_NEXT_ACTIONS = [
  'open_boq',
  'create_contract',
  'set_schedule',
  'send_contract',
  'record_signed_offline',
  'review_payment_claim',
  'send_milestone_request',
  'send_variation_request',
  'prepare_final_account',
  'record_payment',
] as const;

export type ExecutionNextAction = (typeof EXECUTION_NEXT_ACTIONS)[number];

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

/** While the contract runs: a client who says they paid comes first, then billing. */
function inProgressNext(contract: ExecutionContractFacts): ExecutionNextAction {
  if (contract.pendingClaimCount > 0) return 'review_payment_claim';
  if (contract.nextUnbilledMilestoneId !== null) return 'send_milestone_request';
  if (contract.unbilledVariationCount > 0) return 'send_variation_request';
  return 'prepare_final_account';
}

function signedStage(contract: ExecutionContractFacts): ExecutionStageResult {
  if (contract.finalAccountOutstanding === null) {
    return { stage: 'in_progress', next: inProgressNext(contract) };
  }
  if (parseMoney4(contract.finalAccountOutstanding) <= 0n) return { stage: 'settled', next: null };
  const next = contract.pendingClaimCount > 0 ? 'review_payment_claim' : 'record_payment';
  return { stage: 'final_account', next };
}

export function executionStage(facts: ExecutionFacts): ExecutionStageResult {
  const { contract } = facts;
  if (contract === null) {
    return facts.hasIssuedBoq ? { stage: 'no_contract', next: 'create_contract' } : { stage: 'no_boq', next: 'open_boq' };
  }
  switch (contract.status) {
    case 'terminated':
      return { stage: 'terminated', next: null };
    case 'draft':
      return { stage: 'draft', next: contract.scheduleValid ? 'send_contract' : 'set_schedule' };
    case 'issued':
      return { stage: 'awaiting_signature', next: 'record_signed_offline' };
    case 'signed':
      return signedStage(contract);
  }
}
