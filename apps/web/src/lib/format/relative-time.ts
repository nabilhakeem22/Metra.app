// "3 hours ago" / «قبل 3 ساعات», Latin digits in both locales (§4.1). PURE and
// CLIENT-SAFE. The caller passes `nowMs` so a list renders every row against one
// instant and a test is deterministic. Past six days it is a plain date: "8 days
// ago" makes the reader do arithmetic a date would spare them.
import { formatDate } from './date';
import { latnLocale } from './number';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_DAYS_MAX = 6;

export function formatRelativeTime(iso: string, nowMs: number, locale: string): string {
  const instant = new Date(iso).getTime();
  if (Number.isNaN(instant)) return '';
  const elapsed = Math.max(0, nowMs - instant);
  const relative = new Intl.RelativeTimeFormat(latnLocale(locale), { numeric: 'auto' });
  if (elapsed < MINUTE_MS) return relative.format(0, 'second');
  if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
  if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), 'hour');
  const days = Math.floor(elapsed / DAY_MS);
  if (days <= RELATIVE_DAYS_MAX) return relative.format(-days, 'day');
  return formatDate(iso, locale);
}
