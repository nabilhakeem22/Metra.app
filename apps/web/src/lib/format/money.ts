import { formatNumber } from './number';

// EGP only in v1. Stored as NUMERIC(18,4) / carried as string; formatted for
// display with 2 decimals and Latin digits. Symbol: ج.م (ar) / EGP (en).
//
// Absent/invalid input returns '' — it must NOT fabricate "0.00 EGP" from '' /
// whitespace, nor emit " EGP" from null/undefined. Only genuine numbers format.

/** The currency label for `locale`: ج.م in Arabic, EGP otherwise. */
export function moneySymbol(locale: string): string {
  return locale.startsWith('ar') ? 'ج.م' : 'EGP';
}

/** The finite number a money value reads as, or null when it is absent/invalid. */
function readMoneyNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  // Normalize negative zero so -0 formats as "0.00", not "-0.00".
  return Object.is(n, -0) ? 0 : n;
}

/**
 * The figure formatMoney prints WITHOUT the currency label, for a layout that
 * shows the label once beside several figures (the portal's budget range). Same
 * 2 decimals, same Latin digits, same '' for absent/invalid input.
 */
export function formatMoneyAmount(
  value: number | string | null | undefined,
  locale: string,
): string {
  const n = readMoneyNumber(value);
  if (n === null) return '';
  return formatNumber(n, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatMoney(
  value: number | string | null | undefined,
  locale: string,
): string {
  const amount = formatMoneyAmount(value, locale);
  return amount ? `${amount} ${moneySymbol(locale)}` : '';
}

// Like formatMoney, but preserves the EXACT figure: 2 fraction digits normally,
// up to 4 when the value carries sub-piastre precision, and NEVER rounding it up
// (max 4 digits == the stored scale, so a scale-4 value is shown verbatim). Use
// this where "told = charged" must hold — e.g. a shortfall "amount due" that a
// form pre-fills and recordPaymentCore charges to the piastre: rounding it to 2dp
// for display could overstate the owed amount by up to ~0.005 EGP.
export function formatMoneyExact(
  value: number | string | null | undefined,
  locale: string,
): string {
  const n = readMoneyNumber(value);
  if (n === null) return '';
  const amount = formatNumber(n, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return `${amount} ${moneySymbol(locale)}`;
}
