// The one way the site diary reads a device time (Stage 3 site app, plan C2).
// PURE and CLIENT-SAFE. A check-in or a photo time is an instant the phone
// wrote, and the phone and the Worker must read it as the same instant: so it
// must name its offset (or Z). `new Date()` alone would read an offset-less
// string in the host's time zone, roll 30 February over to 2 March and take
// "1" for 2001; this parser refuses each of them instead.

// YYYY-MM-DDTHH:MM, optional :SS and .sss, then Z or ±HH:MM.
const ISO_INSTANT =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d{1,3}))?)?(?:Z|(?<sign>[+-])(?<offsetHours>\d{2}):(?<offsetMinutes>\d{2}))$/;

const MINUTE_MS = 60 * 1000;

function daysInMonth(year: number, month: number): number {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * The instant a strict ISO-8601 string names: a 4-digit year, a real calendar
 * date, a time of day and an explicit offset or Z. Anything else is a caller
 * bug (the S4 validators answer it with 422 first), so it throws RangeError.
 */
export function parseIsoInstant(value: string): Date {
  const groups = ISO_INSTANT.exec(value)?.groups;
  if (groups === undefined) throw new RangeError('Expected an ISO-8601 instant with an explicit offset or Z.');
  const field = (name: string) => Number(groups[name] ?? 0);
  const [year, month, day, hour, minute, second] = ['year', 'month', 'day', 'hour', 'minute', 'second'].map(field);
  const [offsetHours, offsetMinutes] = [field('offsetHours'), field('offsetMinutes')];
  const millisecond = Number((groups.fraction ?? '0').padEnd(3, '0'));
  const inRange =
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) &&
    hour <= 23 && minute <= 59 && second <= 59 && offsetHours <= 23 && offsetMinutes <= 59;
  if (!inRange) throw new RangeError('Expected a real calendar date, time of day and offset.');
  const wallClock = new Date(0);
  // setUTCFullYear, not Date.UTC: Date.UTC reads the years 0 to 99 as 1900 to 1999.
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, millisecond);
  const offsetMs = (groups.sign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * MINUTE_MS;
  return new Date(wallClock.getTime() - offsetMs);
}
