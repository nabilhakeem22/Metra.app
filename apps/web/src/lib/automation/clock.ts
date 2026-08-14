// PURE Cairo-timezone date math for the automation runner. No DB, no next/*.
// All automation scheduling reasons in Africa/Cairo (the locked timezone) — a
// cron tick at any UTC instant maps to the right Cairo calendar day/hour/week.

const CAIRO = 'Africa/Cairo';

interface CairoYmd {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

function cairoParts(now: Date): CairoYmd {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** The Cairo calendar date as `YYYY-MM-DD`. */
export function todayInCairo(now: Date): string {
  const { year, month, day } = cairoParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The Cairo wall-clock hour (0-23). */
export function cairoHour(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

/** Idempotency period key for daily automations: the Cairo date. */
export function dayPeriodKey(now: Date): string {
  return todayInCairo(now);
}

/** ISO week (Cairo) as `<isoYear>-W<ww>` — the period key for weekly digests. */
export function weekPeriodKey(now: Date): string {
  const { year, month, day } = cairoParts(now);
  // Thursday-anchored ISO week, computed on a UTC-midnight date to avoid drift.
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayOfWeek + 3); // move to the Thursday
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
  const week =
    1 +
    Math.round(
      (date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Whole days from `from` (YYYY-MM-DD) to `to` (YYYY-MM-DD); positive if to>from. */
export function daysBetween(from: string, to: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(to) - parse(from)) / (24 * 60 * 60 * 1000));
}

/** `date` (YYYY-MM-DD) shifted by `days` (may be negative), as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}
