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
import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';

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

/** The split a studio with no schedule yet starts from: 50 / 30 / 20 percent. */
export const FALLBACK_FEE_SPLIT: readonly { kind: MilestoneKind; percent: string }[] = [
  { kind: 'deposit', percent: '50' },
  { kind: 'gate_b', percent: '30' },
  { kind: 'balance', percent: '20' },
];

/** The org's most recently written fee schedule (no schema: read off its milestones). */
export interface LastFeeSchedule {
  designFee: string | null;
  milestones: { kind: MilestoneKind; basis: MilestoneBasis; value: string }[];
}

/** What the fee form opens with. The basis is always percent. */
export interface FeeSplitPrefill {
  source: 'lastUsed' | 'fallback';
  rows: { kind: MilestoneKind; value: string }[];
}

const FALLBACK_PREFILL: FeeSplitPrefill = {
  source: 'fallback',
  rows: FALLBACK_FEE_SPLIT.map(({ kind, percent }) => ({ kind, value: percent })),
};

/** "50.0000" -> "50", "33.3300" -> "33.33": the form shows what a person would type. */
function withoutTrailingZeros(scale4: string): string {
  return scale4.includes('.') ? scale4.replace(/\.?0+$/, '') : scale4;
}

/** Hundredths of a percent -> "33.34". */
function percentOfHundredths(hundredths: bigint): string {
  return withoutTrailingZeros(formatMoney4(hundredths * 100n));
}

/**
 * Each amount as a share of the fee, in hundredths of a percent, rounding half up
 * in BigInt (never float). The residual that makes the shares sum to exactly
 * 100% goes to the LARGEST share (the last of equals, in due order): it is never
 * more than a few hundredths, so the largest row can always absorb it without
 * going negative, which a small last row could not.
 */
function percentsOfAmounts(amounts4: bigint[], fee4: bigint): bigint[] {
  const shares = amounts4.map((amount4) => (amount4 * 10000n * 2n + fee4) / (2n * fee4));
  const residual = 10000n - shares.reduce((sum, share) => sum + share, 0n);
  let largest = 0;
  shares.forEach((share, index) => {
    if (share >= shares[largest]) largest = index;
  });
  if (shares.length > 0) shares[largest] += residual;
  return shares;
}

/**
 * The fee form's opening split: the org's LAST used split, in percent, over the
 * default rows plus whatever that schedule also billed (in due order); a default
 * row it did not bill opens empty. No schedule, or an amount schedule with no
 * usable fee, falls back to 50/30/20.
 */
export function deriveFeeSplitPrefill(last: LastFeeSchedule | null): FeeSplitPrefill {
  if (!last || last.milestones.length === 0) return FALLBACK_PREFILL;
  const kinds = [
    ...new Set([...DEFAULT_MILESTONE_KINDS, ...last.milestones.map((row) => row.kind)]),
  ].sort(byDueOrder);
  const billed = [...last.milestones].sort((a, b) => byDueOrder(a.kind, b.kind));

  let valueOf: Map<MilestoneKind, string>;
  if (billed[0].basis === 'percent') {
    valueOf = new Map(
      billed.map((row) => [row.kind, withoutTrailingZeros(formatMoney4(parseMoney4(row.value)))]),
    );
  } else {
    const fee4 = parseMoney4(last.designFee);
    if (fee4 <= 0n) return FALLBACK_PREFILL;
    const shares = percentsOfAmounts(
      billed.map((row) => parseMoney4(row.value)),
      fee4,
    );
    valueOf = new Map(billed.map((row, index) => [row.kind, percentOfHundredths(shares[index])]));
  }
  return {
    source: 'lastUsed',
    rows: kinds.map((kind) => ({ kind, value: valueOf.get(kind) ?? '' })),
  };
}
