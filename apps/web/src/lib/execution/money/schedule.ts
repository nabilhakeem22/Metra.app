// The execution contract's payment schedule: the terms the client signs. PURE
// and CLIENT-SAFE, so the Schedule tab's pre-check and the server core refuse
// the same rows under the same boxes. Exact scale-4 BigInt money, never float.
//
// One basis per schedule: percentages that sum to exactly 100.0000, or amounts
// that sum to the contract's `original_value` to the piastre. 1 to 12 rows.
import type { MilestoneBasis } from '@metra/db';
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { readMoneyField } from '@/lib/validation/field-rules';
import { clean } from '@/lib/validation/text';
import { boundedText, requiredText } from '@/lib/validation/text-field-rules';
import { milestoneAmounts } from './milestone-amounts';

export const MAX_SCHEDULE_ROWS = 12;
export const MAX_SCHEDULE_LABEL_CHARS = 80;

/** The smallest row a schedule takes: one piastre, or 0.01 percent. */
const MIN_ROW_VALUE = '0.01';
const HUNDRED_PERCENT_4 = parseMoney4('100');

/** One row as the studio typed it. */
export interface ScheduleRowInput {
  labelAr: string | null;
  labelEn: string | null;
  basis: MilestoneBasis;
  value: string;
}

/** One row as it is stored: trimmed labels, canonical scale-4 value. */
export interface CleanScheduleRow {
  labelAr: string | null;
  labelEn: string | null;
  basis: MilestoneBasis;
  value: string;
  sortOrder: number;
}

export type ScheduleValidation =
  | { ok: true; rows: CleanScheduleRow[] }
  | { ok: false; errors: FieldErrors };

/** A scale-4 figure as a person reads it in a sentence: '80.0000' -> '80'. */
function plainDecimal(value4: bigint): string {
  return formatMoney4(value4).replace(/\.?0+$/, '');
}

/** Either label is enough; each one is capped. */
function labelError(row: ScheduleRowInput): FieldError | null {
  if (requiredText(row.labelAr) && requiredText(row.labelEn)) return { code: 'required' };
  return (
    boundedText(row.labelAr, MAX_SCHEDULE_LABEL_CHARS) ??
    boundedText(row.labelEn, MAX_SCHEDULE_LABEL_CHARS)
  );
}

/** The row's value at scale 4, or the refusal under its box. */
function readRowValue(row: ScheduleRowInput, max4: bigint): { value4: bigint } | { error: FieldError } {
  const missing = requiredText(row.value);
  if (missing) return { error: missing };
  const read = readMoneyField(row.value, {});
  if (!read.ok) return { error: read.error };
  const value4 = parseMoney4(read.value);
  if (value4 < parseMoney4(MIN_ROW_VALUE) || value4 > max4) {
    return { error: { code: 'out_of_range', params: { min: MIN_ROW_VALUE, max: plainDecimal(max4) } } };
  }
  return { value4 };
}

/** The refusal of the schedule as a whole, before any row is read. */
function shapeError(rows: ScheduleRowInput[]): FieldError | null {
  if (rows.length === 0) return { code: 'required' };
  if (rows.length > MAX_SCHEDULE_ROWS) return { code: 'schedule_too_long' };
  const bases = new Set(rows.map((row) => row.basis));
  const [basis] = bases;
  if (bases.size !== 1 || (basis !== 'percent' && basis !== 'amount')) {
    return { code: 'contract_schedule_invalid' };
  }
  return null;
}

/**
 * Validate a whole schedule against the contract value. Errors sit under
 * `milestones.{i}.label`, `milestones.{i}.value` (every bad row at once), or
 * `milestones` for the schedule as a whole: no rows, more than 12, a mixed
 * basis, rows that do not add up (`schedule_sum_mismatch`, params
 * {expected, actual}), or a contract value too small for the split
 * (`schedule_value_too_small`, params {value}).
 */
export function validateSchedule(
  rows: ScheduleRowInput[],
  originalValue: string,
  taxAmount: string,
): ScheduleValidation {
  const shape = shapeError(rows);
  if (shape) return { ok: false, errors: { milestones: shape } };
  if (parseMoney4(originalValue) <= 0n) return valueTooSmall(originalValue);

  const percent = rows[0].basis === 'percent';
  const target4 = percent ? HUNDRED_PERCENT_4 : parseMoney4(originalValue);
  const errors: Record<string, FieldError> = {};
  const clean4: bigint[] = [];
  rows.forEach((row, index) => {
    const label = labelError(row);
    if (label) errors[`milestones.${index}.label`] = label;
    const read = readRowValue(row, target4);
    if ('error' in read) errors[`milestones.${index}.value`] = read.error;
    else clean4.push(read.value4);
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const sum4 = clean4.reduce((total, value4) => total + value4, 0n);
  if (sum4 !== target4) {
    const params = { expected: plainDecimal(target4), actual: plainDecimal(sum4) };
    return { ok: false, errors: { milestones: { code: 'schedule_sum_mismatch', params } } };
  }
  const cleanRows = rows.map((row, index) => ({
    labelAr: clean(row.labelAr),
    labelEn: clean(row.labelEn),
    basis: row.basis,
    value: formatMoney4(clean4[index]),
    sortOrder: index,
  }));
  if (!everyRowBillable(cleanRows, originalValue, taxAmount)) return valueTooSmall(originalValue);
  return { ok: true, rows: cleanRows };
}

function valueTooSmall(originalValue: string): ScheduleValidation {
  const params = { value: plainDecimal(parseMoney4(originalValue)) };
  return { ok: false, errors: { milestones: { code: 'schedule_value_too_small', params } } };
}

/**
 * Every row can become a payment request: an amount above 0 and a VAT share
 * from 0 to that amount (the request's CHECKs). Read with the SAME
 * `milestoneAmounts` the requests are issued with; only a contract value too
 * small for its split fails it.
 */
function everyRowBillable(rows: CleanScheduleRow[], originalValue: string, taxAmount: string): boolean {
  return milestoneAmounts(rows, originalValue, taxAmount).every((row) => {
    const amount4 = parseMoney4(row.amount);
    const tax4 = parseMoney4(row.taxAmount);
    return amount4 > 0n && tax4 >= 0n && tax4 <= amount4;
  });
}
