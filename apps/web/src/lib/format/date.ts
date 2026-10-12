// Gregorian, DD/MM/YYYY, Latin digits. Store UTC, render in Africa/Cairo (§4.1).
import { cachedDateTimeFormat } from './intl-cache';
import { latnLocale } from './number';

const CAIRO = 'Africa/Cairo';
// Frozen: the formatter cache works out a frozen options object's key once.
const DATE_OPTIONS: Intl.DateTimeFormatOptions = Object.freeze({ timeZone: CAIRO, day: '2-digit', month: '2-digit', year: 'numeric' });
const TIME_OPTIONS: Intl.DateTimeFormatOptions = Object.freeze({ timeZone: CAIRO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function formatDate(input: Date | string | number, locale: string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  const parts = cachedDateTimeFormat(latnLocale(locale), DATE_OPTIONS).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  // Force DD/MM/YYYY order regardless of the locale's default pattern.
  return `${get('day')}/${get('month')}/${get('year')}`;
}

/** Clock time, HH:mm (24-hour), Cairo time, Latin digits: "14:02". */
export function formatTime(input: Date | string | number, locale: string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return cachedDateTimeFormat(latnLocale(locale), TIME_OPTIONS).format(date);
}
