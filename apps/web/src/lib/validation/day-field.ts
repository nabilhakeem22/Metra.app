// The day boxes of the execution forms: the day a client signed on paper, the
// day a payment was received or a line measured, and a payment request's due
// date. PURE and
// CLIENT-SAFE: a dialog checks on Save, the core again on arrival. "Today" is
// always the Cairo day the caller passes in, never the runtime's.
import type { FieldError } from '@/lib/actions/field-errors';
import { formatDate } from '@/lib/format/date';
import type { FieldRead } from './field-rules';
import { validIsoDate } from './iso-date';

/** Year 0 is a day JavaScript knows and Postgres refuses (22008): not a day. */
const FIRST_STORABLE_DAY = '0001-01-01';

/** A typed `YYYY-MM-DD` day, null when the box is blank. */
function readDay(raw: unknown): FieldRead<string | null> {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return { ok: true, value: null };
  if (!validIsoDate(value) || value < FIRST_STORABLE_DAY) return { ok: false, error: { code: 'invalid_date' } };
  return { ok: true, value };
}

/** A required day that has already come: today in Cairo or an earlier one. */
export function readDayUpToToday(raw: unknown, todayInCairo: string): FieldRead<string> {
  const read = readDay(raw);
  if (!read.ok) return read;
  if (read.value === null) return { ok: false, error: { code: 'required' } };
  if (read.value > todayInCairo) return { ok: false, error: { code: 'date_in_future' } };
  return { ok: true, value: read.value };
}

/** An optional day from today in Cairo on; a blank box is no day. */
export function readOptionalDayFromToday(raw: unknown, todayInCairo: string): FieldRead<string | null> {
  const read = readDay(raw);
  if (!read.ok || read.value === null) return read;
  if (read.value < todayInCairo) return { ok: false, error: { code: 'date_in_past' } };
  return read;
}

/** No studio recorded this contract's money or measurements before this day: an earlier one is a typo. */
const FIRST_RECORDED_DAY = '2000-01-01';

/**
 * readDayUpToToday for a day the studio records after the fact (money
 * received, a line measured): a day before 2000-01-01 is `invalid_date`, since
 * a two-digit year typed into the date box reads as 0026 (A4 F5).
 */
export function readRecordedDay(raw: unknown, todayInCairo: string): FieldRead<string> {
  const read = readDayUpToToday(raw, todayInCairo);
  if (read.ok && read.value < FIRST_RECORDED_DAY) return { ok: false, error: { code: 'invalid_date' } };
  return read;
}

/** `code` under the day when it is before `issuedOn`, said with the issue day as the app shows every date. */
function dayBefore(code: 'date_before_issue' | 'date_before_variation_issue', day: string, issuedOn: string): FieldError | null {
  return day < issuedOn ? { code, params: { date: formatDate(issuedOn, 'en') } } : null;
}

/** A day before its contract was issued (`date_before_issue`), or null. Both `YYYY-MM-DD`. */
export function dayBeforeIssue(day: string, issuedOn: string): FieldError | null {
  return dayBefore('date_before_issue', day, issuedOn);
}

/** A day before its change order was issued (`date_before_variation_issue`), or null. Both `YYYY-MM-DD`. */
export function dayBeforeVariationIssue(day: string, issuedOn: string): FieldError | null {
  return dayBefore('date_before_variation_issue', day, issuedOn);
}
