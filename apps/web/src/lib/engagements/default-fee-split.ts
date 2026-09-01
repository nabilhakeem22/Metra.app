// Design-Engagement Machine — the DEFAULT payment split a new fee schedule opens
// with. PURE and CLIENT-SAFE: no db import, no `server-only`, no 'use client', so
// the fee form and its test read the same declaration.
//
// THREE payments, because that is what an Egyptian fit-out studio actually asks
// for, and each one is named by WHEN it falls rather than by its internal gate
// letter:
//   1. deposit  — to start the work        (gates `confirmAndPayDeposit`)
//   2. gate_b   — after the design is confirmed (gates `approveDesign`,
//                 final_approval -> shop_drawings)
//   3. balance  — the final payment        (gates both execution-decision exits)
//
// `gate_a` (the concept-stage installment) is deliberately NOT in the default. It
// stays available as an OPTIONAL fourth row for a studio that bills at concept
// selection too. Omitting a milestone is already a first-class, owner-locked rule
// in the money guards — an ABSENT milestone is a FREE GATE (required = 0, clears
// with no payment) — so a three-payment schedule needs no machine change at all:
// `gateAInstallmentCleared` simply passes.
import type { MilestoneKind } from '@metra/db';

/** The three milestones a new schedule starts with, in the order they fall due. */
export const DEFAULT_MILESTONE_KINDS: readonly MilestoneKind[] = [
  'deposit',
  'gate_b',
  'balance',
];

/** Every milestone a studio MAY bill, in due order. The ones outside the default
 *  are offered as additions rather than pre-filled rows. */
export const ALL_MILESTONE_KINDS: readonly MilestoneKind[] = [
  'deposit',
  'gate_a',
  'gate_b',
  'balance',
];

/** The milestones NOT in the default split — offered as "add a payment". */
export const OPTIONAL_MILESTONE_KINDS: readonly MilestoneKind[] =
  ALL_MILESTONE_KINDS.filter((kind) => !DEFAULT_MILESTONE_KINDS.includes(kind));

/**
 * Order a set of milestone kinds by when they fall due, so a schedule the studio
 * built by adding an optional payment still reads top-to-bottom in project order
 * rather than in click order.
 */
export function byDueOrder(a: MilestoneKind, b: MilestoneKind): number {
  return ALL_MILESTONE_KINDS.indexOf(a) - ALL_MILESTONE_KINDS.indexOf(b);
}
