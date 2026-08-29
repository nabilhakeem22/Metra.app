// Design-Engagement Machine — guard facts & verdict contract (Step 2, widened in
// Step 4). PURE and CLIENT-SAFE: the shared shapes every guard reads and returns.
// A guard NEVER takes a `tx`, does I/O, or touches the DB — the executor gathers
// every fact first, then guards only decide. Later steps WIDEN `GuardFacts`
// (artifacts, revision counters) without changing this contract.
import type {
  DesignEngagement,
  EngagementArtifact,
  EngagementChangeOrder,
  EngagementEvent,
  EngagementMilestone,
  PaymentEvent,
} from '@metra/db';
import type { ActionCode } from '@/lib/actions/result';

/**
 * The facts a guard may read. Widened in Step 4 (fee-schedule `milestones` + the
 * append-only `payments` ledger), Step 5 (the recorded `artifacts`), Step 9
 * (the `changeOrders` raised by over-allowance revisions), and Step 13 (the
 * append-only `events` ledger), so each gate can decide from pure data the
 * executor pre-loaded.
 */
export interface GuardFacts {
  engagement: DesignEngagement;
  milestones: EngagementMilestone[];
  payments: PaymentEvent[];
  artifacts: EngagementArtifact[];
  changeOrders: EngagementChangeOrder[];
  events: EngagementEvent[];
}

/** A guard's verdict: pass, or fail with the coded reason to surface. */
export type GuardResult = { ok: true } | { ok: false; code: ActionCode };

/** Guard identifiers referenced by the transition registry. */
export type GuardKey =
  | 'scopeInputsPresent'
  | 'depositCleared'
  | 'gateAInstallmentCleared'
  | 'gateBInstallmentCleared'
  | 'romAcknowledged'
  | 'asBuiltReconciled'
  | 'spatialBaseReady'
  | 'optionsReady'
  | 'revisionCosSettled'
  | 'rendersPresent'
  | 'asBuiltDueOpen'
  | 'shopDrawingsPresent'
  | 'boqPresent'
  | 'balanceCleared'
  | 'handoffAcknowledged'
  | 'pendingGuard';

/** The shared pass verdict every guard returns on success. */
export const pass: GuardResult = { ok: true };
