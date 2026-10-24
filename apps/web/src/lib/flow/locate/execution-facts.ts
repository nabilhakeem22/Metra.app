// The ONE fact model of the EXECUTION phase. PURE and CLIENT-SAFE. The studio
// cockpit and the client home are two projections of the same facts: both
// locators read this type, both take the STEP from the contract's stage
// (`executionStage()`, lib/execution/stage.ts), so the two rails can never show
// different steps or a different end. Only whose move it is and the reason
// differ by audience (./execution-studio.ts, ./execution-client.ts).
import { executionStage, type ExecutionFacts, type ExecutionStage, type ExecutionStageResult } from '@/lib/execution/stage';
import { assertCount } from '../assert';
import type { ExecutionStepKey } from '../phases/execution';
import type { PhaseStatus } from '../types';

/**
 * What both sides know about a delivery's execution. The studio builds it from
 * `getExecutionFacts` (lib/execution/queries/facts.ts) plus the three fields
 * after `stage`, which that query does not read yet; the client home's SDF
 * computes every field in SQL (client home H4), so neither side counts from a
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
   * the ones ISSUED to the client. The rest are approved internally and not
   * issued yet: the client cannot see them, so they are the studio's to issue.
   * Zero when there is no contract.
   */
  issuedChangeOrderCount: number;
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
  return (facts.stage.contract?.openVariationCount ?? 0) - facts.issuedChangeOrderCount;
}

/** Refuse facts no query can produce: a count that is not one, or counts that contradict each other. */
function assertFacts(facts: ExecutionFlowFacts): void {
  const contract = facts.stage.contract;
  assertCount(facts.issuedChangeOrderCount, 'issuedChangeOrderCount');
  assertCount(facts.unclaimedDueRequestCount, 'unclaimedDueRequestCount');
  if (contract) {
    assertCount(contract.openVariationCount, 'openVariationCount');
    assertCount(contract.unbilledVariationCount, 'unbilledVariationCount');
    assertCount(contract.unpaidRequestCount, 'unpaidRequestCount');
    assertCount(contract.pendingClaimCount, 'pendingClaimCount');
  }
  if (internalChangeOrderCount(facts) < 0) throw new Error('issuedChangeOrderCount exceeds openVariationCount');
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
