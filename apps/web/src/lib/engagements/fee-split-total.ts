// Design-Engagement Machine — the fee form's LIVE TOTAL. PURE and CLIENT-SAFE:
// exact scale-4 BigInt math (never float), and the same acceptance rules as
// `validateFeeSchedule` (fee-schedule.ts), so a form whose Submit is enabled
// sends a payload the server accepts.
import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import { formatMoney4, isMoneyString, parseMoney4 } from '@/lib/aggregates/proposal-totals';

const HUNDRED_PERCENT_4 = parseMoney4('100');

export interface FeeSplitSummary {
  /** The scale-4 sum of the rows that hold a valid value. */
  total: string;
  /** What the rows must add up to (scale-4): 100 for percent, the fee for amount; null with no fee. */
  target: string | null;
  hasFee: boolean;
  hasDeposit: boolean;
  balanced: boolean;
  canSubmit: boolean;
}

/**
 * Sum the split and say whether it may be submitted. Rows left empty are
 * skipped, exactly as the form omits them from the payload; any other value
 * that is not a non-negative money string unbalances the split.
 */
export function summarizeFeeSplit(input: {
  basis: MilestoneBasis;
  designFee: string;
  rows: { kind: MilestoneKind; value: string }[];
}): FeeSplitSummary {
  const fee = input.designFee.trim();
  const hasFee = isMoneyString(fee) && parseMoney4(fee) > 0n;

  let sum4 = 0n;
  let invalid = false;
  let filled = 0;
  let hasDeposit = false;
  for (const row of input.rows) {
    const value = row.value.trim();
    if (value === '') continue;
    filled += 1;
    if (row.kind === 'deposit') hasDeposit = true;
    if (!isMoneyString(value) || parseMoney4(value) < 0n) {
      invalid = true;
      continue;
    }
    sum4 += parseMoney4(value);
  }

  let target4: bigint | null = null;
  if (input.basis === 'percent') target4 = HUNDRED_PERCENT_4;
  else if (hasFee) target4 = parseMoney4(fee);

  const balanced = !invalid && filled > 0 && target4 !== null && sum4 === target4;
  return {
    total: formatMoney4(sum4),
    target: target4 === null ? null : formatMoney4(target4),
    hasFee,
    hasDeposit,
    balanced,
    canSubmit: hasFee && hasDeposit && balanced,
  };
}
