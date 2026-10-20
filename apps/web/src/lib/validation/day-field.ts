// The day boxes of the execution forms: the day a client signed on paper, the
// day a payment was received, and a payment request's due date. PURE and
// CLIENT-SAFE: a dialog checks on Save, the core again on arrival. "Today" is
// always the Cairo day the caller passes in, never the runtime's.
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
