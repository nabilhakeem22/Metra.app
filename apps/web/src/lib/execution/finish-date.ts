// The contract's revised finish day (plan A24): its end date plus the days its
// APPROVED change orders add. PURE and CLIENT-SAFE, computed on read, never
// stored: the contract row is frozen once issued.
import { validIsoDate } from '@/lib/validation/iso-date';

const DAY_MS = 86_400_000;

/**
 * `endDate` + `extensionDays`, as `YYYY-MM-DD`. Calendar arithmetic in UTC, so
 * no time zone or daylight saving change can move the day. Null when the
 * contract has no end date (only the days added can be said then), or when the
 * sum leaves the calendar a `date` column can hold.
 */
export function revisedFinishDate(endDate: string | null, extensionDays: number): string | null {
  if (endDate === null || !validIsoDate(endDate)) return null;
  const revised = new Date(Date.parse(`${endDate}T00:00:00Z`) + extensionDays * DAY_MS);
  if (Number.isNaN(revised.getTime())) return null;
  const day = revised.toISOString().slice(0, 10);
  return validIsoDate(day) ? day : null;
}
