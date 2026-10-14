// The one date the client page promises for the next step. Pure and client-
// safe: the card checks it on Save and the core again on arrival, both against
// today in Cairo.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { addDays, todayInCairo } from '@/lib/automation/clock';
import type { FieldRead } from '@/lib/validation/field-rules';
import { validIsoDate } from '@/lib/validation/iso-date';
import { CLIENT_EXPECTED_MAX_DAYS_AHEAD } from './client-expected-view';

export const CLIENT_EXPECTED_FIELDS = ['expectedOn'] as const;
export type ClientExpectedField = (typeof CLIENT_EXPECTED_FIELDS)[number];

/** The date as stored (null clears it), or why not: not a real day, or outside
 *  today to a year ahead. */
export function readExpectedOn(value: unknown, now: Date): FieldRead<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string' || !validIsoDate(value)) {
    return { ok: false, error: { code: 'invalid_date' } };
  }
  const today = todayInCairo(now);
  if (value < today || value > addDays(today, CLIENT_EXPECTED_MAX_DAYS_AHEAD)) {
    return { ok: false, error: { code: 'expected_date_out_of_range' } };
  }
  return { ok: true, value };
}

/** The card's pre-check for Save; an empty box is a day not yet picked. */
export function clientExpectedFieldErrors(typed: string, now: Date): FieldErrors<ClientExpectedField> {
  if (typed === '') return { expectedOn: { code: 'required' } };
  const read = readExpectedOn(typed, now);
  return read.ok ? {} : { expectedOn: read.error };
}
