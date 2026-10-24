// The diary day a visit belongs to (Stage 3 site app, plan C2): the calendar
// date in Africa/Cairo of the instant the engineer checked in. PURE and
// CLIENT-SAFE. The server stores the same rule as
// `(checked_in_at at time zone 'Africa/Cairo')::date`; this is its TypeScript
// twin for the phone's offline day view and the API answers.
//
// Intl's time-zone data decides the offset, so Egypt's summer time (UTC+3) and
// winter time (UTC+2) need no table here.
import { todayInCairo } from '@/lib/automation/clock';
import { parseIsoInstant } from './iso-instant';

const DIARY_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `YYYY-MM-DD` in Africa/Cairo for a strict ISO instant (see parseIsoInstant).
 * An instant that is not one, or whose Cairo day leaves the 4-digit years, is a
 * caller bug: RangeError.
 */
export function cairoDate(instantIso: string): string {
  const day = todayInCairo(parseIsoInstant(instantIso));
  if (!DIARY_DAY.test(day)) throw new RangeError('cairoDate needs an instant whose Cairo day has a 4-digit year.');
  return day;
}
