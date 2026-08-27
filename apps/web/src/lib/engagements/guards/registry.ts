// Design-Engagement Machine — guard registry (Step 2). Composes the money and
// readiness guard families into the single `GuardKey -> predicate` map the
// executor resolves against. PURE and CLIENT-SAFE: static wiring only.
import type { GuardFacts, GuardKey, GuardResult } from './facts';
import {
  depositCleared,
  gateAInstallmentCleared,
  gateBInstallmentCleared,
  revisionCosSettled,
} from './money';
import {
  asBuiltDueOpen,
  asBuiltReconciled,
  optionsReady,
  pendingGuard,
  rendersPresent,
  romAcknowledged,
  scopeInputsPresent,
  spatialBaseReady,
} from './readiness';

/** The guard registry — the executor resolves a GuardKey to its predicate here. */
export const GUARDS: Record<GuardKey, (facts: GuardFacts) => GuardResult> = {
  scopeInputsPresent,
  depositCleared,
  gateAInstallmentCleared,
  gateBInstallmentCleared,
  romAcknowledged,
  asBuiltReconciled,
  spatialBaseReady,
  optionsReady,
  revisionCosSettled,
  rendersPresent,
  asBuiltDueOpen,
  pendingGuard,
};
