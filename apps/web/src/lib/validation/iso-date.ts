/**
 * Calendar-date validation for action-core input boundaries.
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`, no 'use client'.
 *
 * Lived in `lib/proposals/validation.ts`, which meant `contracts` imported the
 * PROPOSALS module to find out whether a contract's start date exists. An ISO
 * date is not a proposal idea.
 */

/** Plain `YYYY-MM-DD`. No time, no offset, no single-digit month or day. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `value` is a plain ISO date that names a day that actually exists.
 *
 * The round-trip through `Date` is what catches the impossible ones:
 * `new Date('2026-02-30')` does not throw, it ROLLS OVER to 2026-03-02. Comparing
 * the result back against the input is the only way to tell "the 30th of
 * February" from "the 2nd of March", and a `date` column would have stored the
 * silent rollover.
 */
export function validIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** A four-digit year, then a month and a day of one or two digits each. */
const CALENDAR_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * True when `value` names a day that exists, padded or not (`2026-9-01` is the
 * 1st of September, as Postgres reads it). Refuses what a `date` column would
 * roll over or refuse: the 30th of February, a five-digit year, a time.
 */
export function namesRealDay(value: string): boolean {
  const parts = CALENDAR_DATE_RE.exec(value);
  if (!parts) return false;
  const [, year, month, day] = parts as unknown as [string, string, string, string];
  return validIsoDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
}
