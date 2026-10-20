// The days a change order adds to the contract's finish date (0063
// `variation_orders.time_extension_days`, CHECK 0 to 3650). PURE and
// CLIENT-SAFE: the form's pre-check and the cores refuse the same value under
// the same box.
import type { FieldErrors } from '@/lib/actions/field-errors';
import type { FieldRead } from '@/lib/validation/field-rules';
import { wholeNumberInRange } from '@/lib/validation/number-field-rules';

export const TIME_EXTENSION_FIELD = 'timeExtensionDays';

/** The DB CHECK's inclusive range; the box takes the same bounds. */
export const TIME_EXTENSION_DAYS = { min: 0, max: 3650 } as const;

/** Latin digits only (the server stays strict), with an optional sign and fraction. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * A blank box is no extension (null); anything else must be a whole number of
 * days from 0 to 3650. Directly invokable, so anything may arrive: a value that
 * is not a number at all says so, a number outside the range (a fraction, a
 * minus) says the range.
 */
export function readTimeExtensionDays(raw: unknown): FieldRead<number | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null;
  if (text === '') return { ok: true, value: null };
  if (text === null || !PLAIN_NUMBER.test(text)) return { ok: false, error: { code: 'not_a_number' } };
  const days = Number(text);
  const refusal = wholeNumberInRange(days, TIME_EXTENSION_DAYS.min, TIME_EXTENSION_DAYS.max);
  return refusal ? { ok: false, error: refusal } : { ok: true, value: days };
}

/** The refusal under the box, or nothing: what the form checks before sending. */
export function timeExtensionFieldErrors(raw: unknown): FieldErrors<typeof TIME_EXTENSION_FIELD> {
  const read = readTimeExtensionDays(raw);
  return read.ok ? {} : { [TIME_EXTENSION_FIELD]: read.error };
}
