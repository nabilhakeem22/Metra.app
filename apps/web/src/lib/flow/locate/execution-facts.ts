// The ONE fact model of the EXECUTION phase. PURE and CLIENT-SAFE. The studio
// cockpit and the client home are two projections of the same facts: both
// locators read this type, both take the STEP from the contract's stage
// (`executionStage()`, lib/execution/stage.ts), so the two rails can never show
// different steps or a different end. Only whose move it is and the reason
// differ by audience (./execution-studio.ts, ./execution-client.ts).
import {
  executionStage,
  type ExecutionContractFacts,
  type ExecutionFacts,
  type ExecutionStage,
  type ExecutionStageResult,
} from '@/lib/execution/stage';
import { assertBoolean, assertCount, assertMoney } from '../assert';
import type { ExecutionStepKey } from '../phases/execution';
import type { PhaseStatus } from '../types';

/**
 * What both sides know about a delivery's execution. Both derive it from ONE
 * SQL source, `app_execution_flow_source` (lib/execution/flow-facts.ts): the
 * studio through `getExecutionFacts` (lib/execution/queries/facts.ts), the
 * client home through its token function, which embeds the same statement.
 * Each count is taken in SQL over every row, so neither side counts from a
 * capped list.
 */
export interface ExecutionFlowFacts {
  /** `executionStage()`'s input: the stage, and so the step, on both sides. */
  stage: ExecutionFacts;
  /**
   * The issued contract can still be signed online (the 30-day signing window,
   * OD7). Read only while the contract is issued; false otherwise.
   */
  signingOpen: boolean;
  /**
   * Of `stage.contract.openVariationCount` (change orders awaiting a decision),
   * the ones ISSUED to the client whose link is still live, so the client can
   * answer them online. Zero when there is no contract.
   */
  issuedChangeOrderCount: number;
  /**
   * Of the open change orders, the ones issued to the client whose link has
   * EXPIRED: the client can no longer answer them online, so they are the
   * studio's (the signing-window rule, F4, applied to change orders). The open
   * ones in neither count are approved internally and not issued yet: the
   * client cannot see them, so they are the studio's to issue. Zero when there
   * is no contract.
   */
  expiredChangeOrderCount: number;
  /**
   * Issued payment requests with something still due and no unanswered "I paid"
   * claim, counted over ALL of them in SQL (never from a capped request list).
   * At most `stage.contract.unpaidRequestCount`, and at least that minus
   * `stage.contract.pendingClaimCount` (a request carries one pending claim at
   * most); zero when there is no contract.
   */
  unclaimedDueRequestCount: number;
}

/** Where the contract's stage puts a delivery: the same for the studio and the client. */
export interface ExecutionPosition {
  result: ExecutionStageResult;
  step: ExecutionStepKey | null;
  status: PhaseStatus;
}

const active = (step: ExecutionStepKey) => ({ step, status: 'active' as const });

const STAGE_PLACE: Readonly<Record<ExecutionStage, Omit<ExecutionPosition, 'result'>>> = {
  no_boq: active('contract'),
  no_contract: active('contract'),
  draft: active('contract'),
  awaiting_signature: active('signature'),
  in_progress: active('works'),
  final_account: active('final_account'),
  settled: { step: 'settled', status: 'complete' },
  terminated: { step: null, status: 'closed' },
};

/** Change orders the studio approved and has not issued to the client yet. */
export function internalChangeOrderCount(facts: ExecutionFlowFacts): number {
  return (facts.stage.contract?.openVariationCount ?? 0) - facts.issuedChangeOrderCount - facts.expiredChangeOrderCount;
}

/** The contract's own counts, by its field's name. */
function contractCounts(contract: ExecutionContractFacts): Record<string, number> {
  return {
    openVariationCount: contract.openVariationCount,
    unbilledVariationCount: contract.unbilledVariationCount,
    unpaidRequestCount: contract.unpaidRequestCount,
    pendingClaimCount: contract.pendingClaimCount,
  };
}

/** Every money figure the stage reads off a contract is a decimal, as Postgres renders a numeric. */
function assertContractMoney(contract: ExecutionContractFacts): void {
  assertMoney(contract.billingBalance, 'billingBalance');
  assertMoney(contract.finalAccountBalance, 'finalAccountBalance');
  if (contract.finalAccountOutstanding !== null) assertMoney(contract.finalAccountOutstanding, 'finalAccountOutstanding');
  if (contract.nextUnbilledMilestone !== null) assertMoney(contract.nextUnbilledMilestone.amount, 'nextUnbilledMilestone.amount');
}

/** A contract's counts are counts, its figures numbers, and a draft (neither issued nor signed) has none yet. */
function assertContract(facts: ExecutionFlowFacts, contract: ExecutionContractFacts): void {
  const counts = contractCounts(contract);
  for (const [field, count] of Object.entries(counts)) assertCount(count, field);
  assertContractMoney(contract);
  const flowCounts = [facts.issuedChangeOrderCount, facts.expiredChangeOrderCount, facts.unclaimedDueRequestCount];
  if (contract.status === 'draft' && [...Object.values(counts), ...flowCounts].some((count) => count > 0)) {
    throw new Error('a draft contract carries billing or change-order counts');
  }
}

/**
 * Refuse facts no query can produce: a count that is not one, a flag that is
 * not a boolean, a figure that is not a number, or counts that contradict
 * each other.
 */
function assertFacts(facts: ExecutionFlowFacts): void {
  const contract = facts.stage.contract;
  assertBoolean(facts.signingOpen, 'signingOpen');
  assertCount(facts.issuedChangeOrderCount, 'issuedChangeOrderCount');
  assertCount(facts.expiredChangeOrderCount, 'expiredChangeOrderCount');
  assertCount(facts.unclaimedDueRequestCount, 'unclaimedDueRequestCount');
  if (contract) assertContract(facts, contract);
  if (internalChangeOrderCount(facts) < 0) {
    throw new Error('issuedChangeOrderCount and expiredChangeOrderCount exceed openVariationCount');
  }
  // Every unpaid request is either unclaimed or carries one of the pending claims
  // (at most one per request), so the unclaimed ones lie between those bounds.
  const unpaid = contract?.unpaidRequestCount ?? 0;
  const claims = contract?.pendingClaimCount ?? 0;
  if (facts.unclaimedDueRequestCount > unpaid || facts.unclaimedDueRequestCount < unpaid - claims) {
    throw new Error('unclaimedDueRequestCount disagrees with unpaidRequestCount and pendingClaimCount');
  }
}

export function executionPosition(facts: ExecutionFlowFacts): ExecutionPosition {
  assertFacts(facts);
  // An unknown contract status falls through executionStage's switch.
  const result: ExecutionStageResult | undefined = executionStage(facts.stage);
  if (result === undefined) throw new Error('unknown contract status');
  return { result, ...STAGE_PLACE[result.stage] };
}
