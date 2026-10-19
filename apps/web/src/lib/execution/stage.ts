// The execution stage of a delivery, DERIVED from facts and never stored (plan
// A21): the design machine ends at `execution`, and everything after it hangs
// off the BOQ contract. PURE and CLIENT-SAFE, so the cockpit card and its test
// read one rule.
//
// Each live stage has exactly one next action, and it is never one the server
// would refuse: `prepare_final_account` only appears when the final account
// core would accept it (balance > 0, no open change order, none issued yet).
// A milestone is only suggested while the final account balance still covers
// it, so a de-scope never steers the studio into over-billing. A contract is
// settled only when nothing is owed either way: no unpaid request, no pending
// claim, no open change order and no balance left to bill.
// Settled has no next action. A negative balance (the client was billed more
// than the final value) is settled too: refunds are hidden in v1 (owner
// decision, Oct 19), and the final account card still shows the figures.
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
  'review_final_account',
] as const;

export type ExecutionNextActionKind = (typeof EXECUTION_NEXT_ACTION_KINDS)[number];

/** The one thing to do next. */
export interface ExecutionNextAction {
  kind: ExecutionNextActionKind;
}

/** What the cockpit knows about the delivery's BOQ contract. */
export interface ExecutionContractFacts {
  status: ContractStatus;
  /** The draft schedule passes `validateSchedule`. */
  scheduleValid: boolean;
  /** The first schedule row with no issued request, and what it would bill. */
  nextUnbilledMilestone: { id: string; amount: string } | null;
  pendingClaimCount: number;
  /** Approved change orders that add money and have no issued request. */
  unbilledVariationCount: number;
  /** What is still due on the issued final account request; null when none is issued. */
  finalAccountOutstanding: string | null;
  /** Issued requests with something still due on them (the final account one included). */
  unpaidRequestCount: number;
  /** Change orders still awaiting a decision (internal_approved or issued). */
  openVariationCount: number;
  /**
   * What is left to bill WITHOUT measured residuals: `billingBalance(...)`
   * (money/final-account.ts). STEERING reads it (whether the next milestone
   * still fits), so a mid-job reading never steers the card.
   */
  billingBalance: string;
  /**
   * What is left to bill WITH measured residuals: `computeFinalAccount(...).balance`.
   * The END STATE reads it, once nothing is left to bill, unpaid, claimed or
   * open: above 0 prepare the final account, otherwise settled.
   * Once a final account request is issued, both balances come from the issued
   * final account's figures (its final value minus every issued request).
   */
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

function step(stage: ExecutionStage, kind: ExecutionNextActionKind): ExecutionStageResult {
  return { stage, next: { kind } };
}

const SETTLED: ExecutionStageResult = { stage: 'settled', next: null };

/** Steering: the next milestone still fits in what is left to bill, measurements aside. */
function milestoneWithinBalance(contract: ExecutionContractFacts): boolean {
  const milestone = contract.nextUnbilledMilestone;
  return milestone !== null && parseMoney4(milestone.amount) <= parseMoney4(contract.billingBalance);
}

/**
 * No final account request yet: claims first, then billing and waiting (the
 * steering, on `billingBalance`), then the end state on the FULL balance:
 * the final account while it would bill more, settled otherwise.
 */
function inProgress(contract: ExecutionContractFacts): ExecutionStageResult {
  if (contract.pendingClaimCount > 0) return step('in_progress', 'review_payment_claim');
  if (milestoneWithinBalance(contract)) return step('in_progress', 'send_milestone_request');
  if (contract.unbilledVariationCount > 0) return step('in_progress', 'send_variation_request');
  if (contract.unpaidRequestCount > 0) return step('in_progress', 'record_payment');
  if (contract.openVariationCount > 0) return step('in_progress', 'await_variation_answer');
  if (parseMoney4(contract.finalAccountBalance) > 0n) return step('in_progress', 'prepare_final_account');
  return SETTLED;
}

/** The final account request is issued: settled only once every request and claim is
 *  cleared. Both balances are its figures here, so this branch reads `finalAccountBalance`. */
function finalAccount(contract: ExecutionContractFacts, outstanding: string): ExecutionStageResult {
  if (contract.pendingClaimCount > 0) return step('final_account', 'review_payment_claim');
  // The balance grew after the final account was issued (a request was voided):
  // it no longer bills everything, so it is never settled like this.
  if (parseMoney4(contract.finalAccountBalance) > 0n) return step('final_account', 'review_final_account');
  if (parseMoney4(outstanding) > 0n || contract.unpaidRequestCount > 0) {
    return step('final_account', 'record_payment');
  }
  // Not reachable through the cores (a final account refuses open orders), but
  // settled must never be said while one waits.
  if (contract.openVariationCount > 0) return step('final_account', 'await_variation_answer');
  return SETTLED;
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
