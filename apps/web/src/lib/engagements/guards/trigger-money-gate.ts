// Design-Engagement Machine — WHICH MONEY GATE A TRIGGER CARRIES (split out of
// `guards/money.ts` in wave 4). PURE and CLIENT-SAFE, and the ONLY guard module
// that reads the transition registry — which is why it is a leaf of its own: two
// 'use client' components import it directly to avoid the guards barrel dragging
// GUARDS (and with it the whole guard engine) into their chunk.
import type { MilestoneKind } from '@metra/db';
// Relative import (client-safe): the transition registry is pure static data;
// transitions.ts only type-imports guards back (erased), so this introduces no
// runtime cycle.
import { TRANSITIONS, type Trigger } from '../transitions';
import type { GuardKey } from './facts';

/**
 * The money guards whose shortfall the gate preview surfaces as an "amount due",
 * mapped to the milestone (and, since the four spellings coincide, payment) kind
 * they clear. The hero reads this to know a checklist item is a PAYMENT gate and
 * to pre-fill/route the pay-and-advance form. `revisionCosSettled` is a money gate
 * too but settles change orders (not a milestone), so it is deliberately absent —
 * it has no `milestoneCleared` shortfall.
 */
export const MONEY_GUARD_MILESTONE: Partial<Record<GuardKey, MilestoneKind>> = {
  depositCleared: 'deposit',
  gateAInstallmentCleared: 'gate_a',
  gateBInstallmentCleared: 'gate_b',
  balanceCleared: 'balance',
};

/**
 * The money-milestone guard a trigger carries, or `null` if it is not a payment
 * gate. Reads the trigger's declared guard list and returns the FIRST guard that
 * is a key of {@link MONEY_GUARD_MILESTONE} — so the pay-and-advance core can
 * verify the recorded payment kind matches the milestone the advance will clear
 * (blocking a gate_a receipt paired with `confirmAndPayDeposit`, etc.). PURE and
 * client-safe: reads only the static transition registry.
 *   - `confirmAndPayDeposit` -> `depositCleared`
 *   - `selectConcept`        -> `gateAInstallmentCleared`
 *   - `approveDesign`        -> `gateBInstallmentCleared` (its other guards —
 *     romAcknowledged, asBuiltReconciled — are not money gates)
 */
export function moneyGuardOf(trigger: Trigger): GuardKey | null {
  for (const guard of TRANSITIONS[trigger].guards) {
    if (guard in MONEY_GUARD_MILESTONE) return guard;
  }
  return null;
}
