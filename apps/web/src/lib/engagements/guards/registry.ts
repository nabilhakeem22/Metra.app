// Design-Engagement Machine — guard registry (Step 2). Composes the money and
// readiness guard families — seven concept leaves — into the single
// `GuardKey -> predicate` map the executor resolves against. PURE and
// CLIENT-SAFE: static wiring only. The `Record<GuardKey, …>` annotation is the
// exhaustiveness check: a guard named by an edge but wired here by nobody does
// not compile, which is the job the deleted fail-closed sentinel was doing at
// runtime.
import type { GuardFacts, GuardKey, GuardResult } from './facts';
import { revisionCosSettled } from './money-change-orders';
import {
  balanceCleared,
  depositCleared,
  gateAInstallmentCleared,
  gateBInstallmentCleared,
} from './money-milestones';
import {
  boqPresent,
  optionsReady,
  rendersPresent,
  shopDrawingsPresent,
  spatialBaseReady,
} from './readiness-artifacts';
import {
  asBuiltDueOpen,
  asBuiltReconciled,
  handoffAcknowledged,
  romAcknowledged,
} from './readiness-attestations';
import { scopeInputsPresent } from './readiness-scope';

/** The guard registry — the executor resolves a GuardKey to its predicate here. */
export const GUARDS: Record<GuardKey, (facts: GuardFacts) => GuardResult> = {
  scopeInputsPresent,
  depositCleared,
  gateAInstallmentCleared,
  gateBInstallmentCleared,
  balanceCleared,
  romAcknowledged,
  asBuiltReconciled,
  spatialBaseReady,
  optionsReady,
  revisionCosSettled,
  rendersPresent,
  asBuiltDueOpen,
  shopDrawingsPresent,
  boqPresent,
  handoffAcknowledged,
};
