// Client-portal payments card derivation. PURE and CLIENT-SAFE: no `@metra/db`
// runtime value, no 'use client', no I/O. Turns the DUE-only payment schedule the
// SDF returns into what the portal's payments card renders: the fee total, how much
// is paid, the ONE next milestone, and a state per row. Every figure is scale-4
// BigInt math through the shared money engine (never parseFloat), handed back as a
// canonical scale-4 string for the money formatter.
import { formatMoney4, parseMoney4 } from '../aggregates/proposal-totals';
import type { PublicDelivery, PublicDeliveryMilestone } from './public/types';

/**
 * How one milestone reads to the client:
 *   - `paid`    — settled (ticked, amount struck through)
 *   - `partial` — something cleared, something still owed
 *   - `due`     — the next milestone, nothing cleared on it yet
 *   - `later`   — a future milestone, nothing cleared on it yet (greyed)
 */
export type PaymentRowState = 'paid' | 'partial' | 'due' | 'later';

export interface PaymentRow {
  milestoneKind: string;
  /** Scale-4 strings. `amountRemaining` is due minus cleared, never below zero. */
  amountDue: string;
  amountCleared: string;
  amountRemaining: string;
  state: PaymentRowState;
  /** The first unsettled milestone in schedule order: the one the card highlights. */
  isNext: boolean;
}

export interface PaymentsOverview {
  /** Σ amount_due over the schedule (the design fee the client pays). */
  total: string;
  /** Σ amount_cleared over the schedule. */
  paid: string;
  /** paid / total as a whole percent, floored and clamped to 0..100 (the bar). */
  percentPaid: number;
  rows: PaymentRow[];
  next: PaymentRow | null;
  /** Every milestone is paid (there is at least one). */
  allSettled: boolean;
}

/** One schedule row as the card shows it. `isNext` is decided by the caller. */
function toPaymentRow(milestone: PublicDeliveryMilestone, isNext: boolean): PaymentRow {
  const due = parseMoney4(milestone.amount_due);
  const cleared = parseMoney4(milestone.amount_cleared);
  const remaining = due > cleared ? due - cleared : 0n;
  const settled = milestone.status === 'paid';
  let state: PaymentRowState;
  if (settled) state = 'paid';
  else if (cleared > 0n) state = 'partial';
  else state = isNext ? 'due' : 'later';
  return {
    milestoneKind: milestone.milestone_kind,
    amountDue: formatMoney4(due),
    amountCleared: formatMoney4(cleared),
    amountRemaining: formatMoney4(remaining),
    state,
    isNext,
  };
}

/** paid / total as a floored whole percent in 0..100; an empty total reads 0. */
function percentOf(paid: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  const percent = (paid * 100n) / total;
  if (percent < 0n) return 0;
  return percent > 100n ? 100 : Number(percent);
}

/**
 * Reduce the schedule to the payments card's view, or null when there is no
 * schedule (the card renders nothing). The NEXT milestone is the first one in
 * schedule order whose status is not `paid`, matching the order money is
 * collected in.
 */
export function derivePaymentsOverview(
  schedule: PublicDeliveryMilestone[] | null | undefined,
): PaymentsOverview | null {
  const milestones = Array.isArray(schedule) ? schedule : [];
  if (milestones.length === 0) return null;

  const nextIndex = milestones.findIndex((milestone) => milestone.status !== 'paid');
  const rows = milestones.map((milestone, index) => toPaymentRow(milestone, index === nextIndex));
  const total = milestones.reduce((sum, milestone) => sum + parseMoney4(milestone.amount_due), 0n);
  const paid = milestones.reduce((sum, milestone) => sum + parseMoney4(milestone.amount_cleared), 0n);

  return {
    total: formatMoney4(total),
    paid: formatMoney4(paid),
    percentPaid: nextIndex === -1 ? 100 : percentOf(paid, total),
    rows,
    next: nextIndex === -1 ? null : rows[nextIndex],
    allSettled: nextIndex === -1,
  };
}

/** What the client may do about one milestone's payment right now. */
export type PaymentClaimState =
  | { kind: 'claimable'; amountRemaining: string }
  | { kind: 'pending' }
  | { kind: 'none' };

/**
 * Whether the "I've made this payment" control shows for `milestoneKind`. The SDF
 * decides eligibility (`claimableMilestones`); a milestone with an OPEN claim, or
 * one the client claimed in this session (`claimedThisSession`), shows the
 * waiting-for-confirmation state instead. A milestone the SDF did not list is not
 * claimable, whatever the schedule says.
 */
export function paymentClaimState(
  claim: PublicDelivery['paymentClaim'],
  milestoneKind: string,
  claimedThisSession: ReadonlySet<string>,
): PaymentClaimState {
  const claimable = claim?.claimableMilestones.find(
    (milestone) => milestone.milestoneKind === milestoneKind,
  );
  if (!claimable) return { kind: 'none' };
  if (claimable.hasPendingClaim || claimedThisSession.has(milestoneKind)) {
    return { kind: 'pending' };
  }
  return { kind: 'claimable', amountRemaining: claimable.amountRemaining };
}
