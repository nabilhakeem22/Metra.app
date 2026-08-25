import { formatNumber } from './number';

// EGP only in v1. Stored as NUMERIC(18,4) / carried as string; formatted for
// display with 2 decimals and Latin digits. Symbol: ج.م (ar) / EGP (en).
//
// Absent/invalid input returns '' — it must NOT fabricate "0.00 EGP" from '' /
// whitespace, nor emit " EGP" from null/undefined. Only genuine numbers format.
export function formatMoney(
  value: number | string | null | undefined,
  locale: string,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  let n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  // Normalize negative zero so -0 formats as "0.00", not "-0.00".
  if (Object.is(n, -0)) n = 0;

  const amount = formatNumber(n, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = locale.startsWith('ar') ? 'ج.م' : 'EGP';
  return `${amount} ${symbol}`;
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
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  let n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  if (Object.is(n, -0)) n = 0;

  const amount = formatNumber(n, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const symbol = locale.startsWith('ar') ? 'ج.م' : 'EGP';
  return `${amount} ${symbol}`;
}
