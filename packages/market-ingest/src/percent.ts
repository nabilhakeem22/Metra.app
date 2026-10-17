// Percentage change between two decimals, exact: BigInt at 4 decimal places,
// rounded half away from zero to ONE decimal place (the repo's money rounding,
// apps/web/src/lib/aggregates/proposal-totals.ts). Rates are always computed,
// never read from the bulletin's printed % column.
import type { Decimal } from './format';

const SCALE_DIGITS = 4;

function scaled(decimal: Decimal): bigint {
  const [whole, fraction = ''] = decimal.split('.');
  return BigInt(whole + fraction.padEnd(SCALE_DIGITS, '0').slice(0, SCALE_DIGITS));
}

function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twiceRemainder < denominator) return quotient;
  return quotient + (numerator < 0n ? -1n : 1n);
}

/** ((current - previous) / previous) x 100 to 1 dp, e.g. "4.3" or "-3.4"; null without a base. */
export function percentChange(previous: Decimal | null, current: Decimal | null): string | null {
  if (previous === null || current === null) return null;
  const base = scaled(previous);
  if (base === 0n) return null;
  const tenths = roundHalfAwayFromZero((scaled(current) - base) * 1000n, base);
  const magnitude = tenths < 0n ? -tenths : tenths;
  return `${tenths < 0n ? '-' : ''}${magnitude / 10n}.${magnitude % 10n}`;
}

/** Whether `value` exceeds `limit` (both decimals) without floating point. */
export function decimalExceeds(value: Decimal, limit: Decimal): boolean {
  return scaled(value) > scaled(limit);
}
