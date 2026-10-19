// What each schedule row bills, and the VAT inside it. PURE and CLIENT-SAFE:
// the /c schedule card and the payment request core read the SAME figures.
//
// Milestones are on `original_value` only (plan A7): approved change orders
// bill on their own, and remeasurement only reaches the final account.
// Every row rounds half away from zero (`pctOf`, or a share of the VAT for an
// amount row), then two remainders keep the sums exact to the piastre: the
// LAST row takes the amount remainder (plan A6), and the row with the LARGEST
// amount (the last of them on a tie) takes the VAT remainder, so the rounding
// of many rows never lands on a small one and drives its VAT below zero.
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

/** The row that absorbs the VAT remainder: the largest amount, the last on a tie. */
function largestRow(amounts4: bigint[]): number {
  return amounts4.reduce((largest, amount4, index) => (amount4 >= amounts4[largest] ? index : largest), 0);
}

function sumExcept(values4: bigint[], skip: number): bigint {
  return values4.reduce((total, value4, index) => (index === skip ? total : total + value4), 0n);
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
  if (rows.length === 0) return [];
  const value4 = parseMoney4(originalValue);
  const tax4 = parseMoney4(taxAmount);
  const shares = rows.map((row) => rowShare(row, value4, tax4));
  const amounts4 = shares.map((share) => share.amount4);
  const taxes4 = shares.map((share) => share.tax4);
  const last = rows.length - 1;
  amounts4[last] = value4 - sumExcept(amounts4, last);
  const taxRow = largestRow(amounts4);
  taxes4[taxRow] = tax4 - sumExcept(taxes4, taxRow);
  return amounts4.map((amount4, index) => ({ amount: formatMoney4(amount4), taxAmount: formatMoney4(taxes4[index]) }));
}
