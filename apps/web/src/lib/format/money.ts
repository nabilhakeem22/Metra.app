import { formatNumber } from './number';

// EGP only in v1. Stored as NUMERIC(18,4) / carried as string; formatted for
// display with 2 decimals and Latin digits. Symbol: ج.م (ar) / EGP (en).
export function formatMoney(value: number | string, locale: string): string {
  const amount = formatNumber(value, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = locale.startsWith('ar') ? 'ج.م' : 'EGP';
  return `${amount} ${symbol}`;
}
