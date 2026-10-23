// Western (Latin) digits everywhere, in BOTH locales (§4.1). The `-u-nu-latn`
// Unicode extension forces the latn numbering system; ar-EG uses comma/period
// separators, matching Egyptian business and tax documents.
import { bidiIsolate } from './bidi';
import { cachedNumberFormat } from './intl-cache';

// Frozen: the formatter cache works out a frozen options object's key once.
const TWO_DECIMALS: Intl.NumberFormatOptions = Object.freeze({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UP_TO_TWO_DECIMALS: Intl.NumberFormatOptions = Object.freeze({ minimumFractionDigits: 0, maximumFractionDigits: 2 });

function latnLocale(locale: string): string {
  return locale.includes('-u-nu-') ? locale : `${locale}-u-nu-latn`;
}

export function formatNumber(
  value: number | string,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  return cachedNumberFormat(latnLocale(locale), options).format(n);
}

/**
 * Format a percentage for DISPLAY: exactly 2 fraction digits + a trailing "%",
 * Western digits in both locales. Mirrors formatMoney's guard — null/undefined,
 * blank/whitespace strings, and non-finite values render '' (never "NaN%"). This
 * is display-only; it never changes a stored or computed value.
 */
export function formatPercent(
  value: number | string | null | undefined,
  locale: string,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  let n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  if (Object.is(n, -0)) n = 0;
  return `${formatNumber(n, locale, TWO_DECIMALS)}%`;
}

/**
 * A percentage in parentheses after a figure, " (35.99%)", for a margin shown
 * beside its amount. The percentage is bidi-isolated: after an Arabic money
 * figure the currency letters would make its digits Arabic numbers to the bidi
 * algorithm and put the sign on the wrong side ("(%35.99)"). '' for none.
 */
export function parentheticalPercent(value: number | string | null | undefined, locale: string): string {
  const percent = formatPercent(value, locale);
  return percent === '' ? '' : ` (${bidiIsolate(percent)})`;
}

/**
 * Format a line-item quantity for DISPLAY: up to 2 fraction digits, but with no
 * forced trailing zeros — an integer qty stays "1", "1.5" stays "1.5", and a
 * scale-4 "1.0000" trims to "1". Western digits. Guard mirrors formatMoney.
 */
export function formatQuantity(
  value: number | string | null | undefined,
  locale: string,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  let n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  if (Object.is(n, -0)) n = 0;
  return formatNumber(n, locale, UP_TO_TWO_DECIMALS);
}

export { latnLocale };
