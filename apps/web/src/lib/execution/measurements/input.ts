// What the site engineer or the PM types when they record the FINAL MEASURED
// QUANTITY of one contract line at handover (owner decision Oct 19). PURE and
// CLIENT-SAFE: the record dialog checks it on Save, the core again on arrival.
//
// The quantity may be zero (a line that was not built is measured at nothing),
// is read the way every box reads ("1,500", Arabic digits) and kept at scale 4,
// a fifth decimal refused rather than cut. The day: not after today in Cairo,
// not before 2000-01-01, and not before the contract was issued (the core reads
// that day, the dialog from the tab's view). A correction is a NEW reading: the
// ledger is append-only and the latest recorded one is the line's quantity.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { readNonNegativeExactFigure } from '@/lib/validation/amount-field';
import { dayBeforeIssue, readRecordedDay } from '@/lib/validation/day-field';
import { readFields, readOptionalText } from '@/lib/validation/field-rules';

export const MEASUREMENT_FIELDS = ['measuredQty', 'measuredOn', 'note'] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

/** `contract_line_measurements_note_length`. */
export const MAX_MEASUREMENT_NOTE_CHARS = 500;

export interface TypedMeasurement {
  measuredQty?: unknown;
  measuredOn?: unknown;
  note?: unknown;
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** `todayInCairo` is `YYYY-MM-DD`: a line cannot have been measured after today in Cairo. */
export function readMeasurement(input: TypedMeasurement, todayInCairo: string) {
  return readFields({
    measuredQty: readNonNegativeExactFigure(input.measuredQty),
    measuredOn: readRecordedDay(input.measuredOn, todayInCairo),
    note: readOptionalText(asText(input.note), MAX_MEASUREMENT_NOTE_CHARS),
  });
}

export type CleanMeasurement = Extract<ReturnType<typeof readMeasurement>, { ok: true }>['values'];

/** The record dialog's pre-check: the same rules, as the refusals under each box. */
export function measurementFieldErrors(
  input: TypedMeasurement,
  todayInCairo: string,
  contractIssuedOn: string,
): FieldErrors<MeasurementField> {
  const read = readMeasurement(input, todayInCairo);
  if (!read.ok) return read.errors;
  const beforeIssue = dayBeforeIssue(read.values.measuredOn, contractIssuedOn);
  return beforeIssue ? { measuredOn: beforeIssue } : {};
}

/** How many times its contract quantity a reading may be before the dialog asks the studio to check it. */
export const FAR_BEYOND_CONTRACT_QTY_TIMES = 10n;

/**
 * Whether a reading the dialog has read (scale 4) is more than ten times the
 * line's contract quantity (A5 fix round, S3): most likely a slip of the
 * keyboard, and on a provisional line it moves the final account by the same
 * factor. It is still saved as typed; the dialog only says so before Save.
 */
export function isFarBeyondContractQty(measuredQty: string, contractQty: string): boolean {
  return parseMoney4(measuredQty) > parseMoney4(contractQty) * FAR_BEYOND_CONTRACT_QTY_TIMES;
}
