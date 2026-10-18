// What each schedule row bills, and the VAT inside it. PURE and CLIENT-SAFE:
// the /c schedule card and the payment request core read the SAME figures.
//
// Milestones are on `original_value` only (plan A7): approved change orders
// bill on their own, and remeasurement only reaches the final account.
// Every row but the last rounds half away from zero (`pctOf`, or a share of
// the VAT for an amount row); the LAST row takes the remainder, so the rows
// add up to the contract value and its VAT exactly, to the piastre.
import { invariant } from '@/lib/actions/invariant';
import { formatMoney4, parseMoney4, pctOf } from '@/lib/aggregates/proposal-totals';
import type { CleanScheduleRow } from './schedule';

export interface MilestoneAmount {
  amount: string;
  taxAmount: string;
}

/** round(total x part / whole), half up. A negative figure is a caller's bug:
 *  the rounding below is only right for non-negative ones, so it throws. */
function proportionalShare(total4: bigint, part4: bigint, whole4: bigint): bigint {
  invariant(total4 >= 0n && part4 >= 0n && whole4 >= 0n, 'proportionalShare: negative input');
  if (whole4 === 0n) return 0n;
  return (2n * total4 * part4 + whole4) / (2n * whole4);
}

/** The row's amount and VAT before the remainder rule. */
function rowShare(row: CleanScheduleRow, value4: bigint, tax4: bigint): { amount4: bigint; tax4: bigint } {
  const rowValue4 = parseMoney4(row.value);
  if (row.basis === 'percent') {
    return { amount4: pctOf(value4, rowValue4), tax4: pctOf(tax4, rowValue4) };
  }
  return { amount4: rowValue4, tax4: proportionalShare(tax4, rowValue4, value4) };
}

/**
 * The amount and VAT of each row, in row order. `rows` come from
 * `validateSchedule`, so they share one basis and add up; the remainder rule
 * holds the sums exact even where rounding would not.
 */
export function milestoneAmounts(
  rows: CleanScheduleRow[],
  originalValue: string,
  taxAmount: string,
): MilestoneAmount[] {
  const value4 = parseMoney4(originalValue);
  const tax4 = parseMoney4(taxAmount);
  let billed4 = 0n;
  let billedTax4 = 0n;
  return rows.map((row, index) => {
    const last = index === rows.length - 1;
    const share = last
      ? { amount4: value4 - billed4, tax4: tax4 - billedTax4 }
      : rowShare(row, value4, tax4);
    billed4 += share.amount4;
    billedTax4 += share.tax4;
    return { amount: formatMoney4(share.amount4), taxAmount: formatMoney4(share.tax4) };
  });
}
