// Design-Engagement Machine — guard registry (Step 2). Composes the money and
// readiness guard families into the single `GuardKey -> predicate` map the
// executor resolves against. PURE and CLIENT-SAFE: static wiring only.
import type { GuardFacts, GuardKey, GuardResult } from './facts';
import {
  balanceCleared,
  depositCleared,
  gateAInstallmentCleared,
  gateBInstallmentCleared,
  revisionCosSettled,
} from './money';
import {
  asBuiltDueOpen,
  asBuiltReconciled,
  boqPresent,
  handoffAcknowledged,
  optionsReady,
  pendingGuard,
  rendersPresent,
  romAcknowledged,
  scopeInputsPresent,
  shopDrawingsPresent,
  spatialBaseReady,
} from './readiness';

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
  pendingGuard,
};
