// Design-Engagement Machine — the four MILESTONE GATES (Step 4). PURE and
// CLIENT-SAFE: each is one line over the shared scale-4 arithmetic in
// `milestone-math.ts`, differing only in which milestone kind it clears and which
// code it surfaces. This file is `guards/money.ts` renamed (wave 4); the math, the
// change-order settlement gate and the trigger lookup moved to their own leaves.
import { milestoneCleared } from './milestone-math';
import type { GuardFacts, GuardResult } from './facts';

/**
 * The engagement's deposit is fully paid — the gate for `confirmAndPayDeposit`.
 * Delegates to {@link milestoneCleared} for the `deposit` milestone, surfacing
 * `deposit_not_cleared` on any shortfall or absent fact.
 */
export function depositCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'deposit', 'deposit_not_cleared');
}

/**
 * The engagement's Gate-A installment is fully paid — the gate for `selectConcept`
 * (concept_review → negotiation). Delegates to {@link milestoneCleared} for the
 * `gate_a` milestone, surfacing `gate_a_not_cleared` on any shortfall or absent
 * fact. The client/finance record the Gate-A receipt into the payment ledger
 * beforehand (`recordPaymentCore(kind:'gate_a')`); this guard only verifies it
 * cleared — consistent with the deposit model. No payment is collected here.
 */
export function gateAInstallmentCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'gate_a', 'gate_a_not_cleared');
}

/**
 * The engagement's Gate-B installment is fully paid — a money gate for
 * `approveDesign` (final_approval -> shop_drawings). Delegates to
 * {@link milestoneCleared} for the `gate_b` milestone, surfacing
 * `gate_b_not_cleared` on any shortfall. Absent gate_b milestone = free gate: a
 * schedule that omits gate_b clears without a gate_b payment.
 */
export function gateBInstallmentCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'gate_b', 'gate_b_not_cleared');
}

/**
 * The engagement's balance (final installment) is fully paid — the money gate for
 * BOTH execution-decision exits, `chooseExecution` and `chooseDesignOnly`
 * (owner-locked: the balance clears before either ending). Delegates to
 * {@link milestoneCleared} for the `balance` milestone, surfacing
 * `balance_not_cleared` on any shortfall. Absent balance milestone = free gate
 * (the existing rule): a schedule that omits it clears without a balance payment.
 */
export function balanceCleared(facts: GuardFacts): GuardResult {
  return milestoneCleared(facts, 'balance', 'balance_not_cleared');
}
