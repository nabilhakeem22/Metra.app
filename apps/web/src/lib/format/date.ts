// Gregorian, DD/MM/YYYY, Latin digits. Store UTC, render in Africa/Cairo (§4.1).
import { latnLocale } from './number';

const CAIRO = 'Africa/Cairo';

export function formatDate(input: Date | string | number, locale: string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat(latnLocale(locale), {
    timeZone: CAIRO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  // Force DD/MM/YYYY order regardless of the locale's default pattern.
  return `${get('day')}/${get('month')}/${get('year')}`;
}
