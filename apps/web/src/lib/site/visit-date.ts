// The diary day a visit belongs to (Stage 3 site app, plan C2): the calendar
// date in Africa/Cairo of the instant the engineer checked in. PURE and
// CLIENT-SAFE. The server stores the same rule as
// `(checked_in_at at time zone 'Africa/Cairo')::date`; this is its TypeScript
// twin for the phone's offline day view and the API answers.
//
// Intl's time-zone data decides the offset, so Egypt's summer time (UTC+3) and
// winter time (UTC+2) need no table here.
import { todayInCairo } from '@/lib/automation/clock';

/** `YYYY-MM-DD` in Africa/Cairo for an ISO instant. An unparseable instant is a caller bug. */
export function cairoDate(instantIso: string): string {
  const instant = new Date(instantIso);
  if (Number.isNaN(instant.getTime())) throw new RangeError('cairoDate needs a parseable ISO instant.');
  return todayInCairo(instant);
}
