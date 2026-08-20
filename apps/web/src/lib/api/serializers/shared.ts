// Shared helpers for the Public API (v1) serializers. Pure. Public shapes use
// snake_case keys, UUID ids, Western-numeral strings, and money/percentage
// values as 2-decimal numeric strings (rounded from the DB numeric(18,4)).
import { parseMoney4 } from '../../aggregates/proposal-totals';

/** Normalize a timestamptz (Date or ISO string) to an ISO-8601 string. */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Round a scale-4 money/percentage string ("1000.0000", "14.0000") to a canonical
 * 2-decimal string ("1000.00", "14.00"). Uses exact BigInt math (round half AWAY
 * from zero, matching the money engine) — NEVER parseFloat, so large NUMERIC(18,4)
 * values keep full precision. The DB stores scale-4; this only trims the display
 * scale the API emits, never the stored/computed precision.
 */
export function toApiMoney(scale4: string | null | undefined): string {
  const units = parseMoney4(scale4); // BigInt at 1e-4
  const neg = units < 0n;
  const abs = neg ? -units : units;
  // 1e-4 -> 1e-2: divide by 100, rounding the exact half up on the magnitude.
  const cents = (abs + 50n) / 100n;
  const intPart = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, '0');
  return `${neg && cents !== 0n ? '-' : ''}${intPart}.${frac}`;
}

/**
 * A quantity as a clean numeric string — rounded to at most 2 decimals and with
 * trailing-zero noise trimmed ("1.0000" -> "1", "1.5000" -> "1.5", "2.2500" ->
 * "2.25"). Reuses toApiMoney's exact 2-decimal rounding, then drops the trailing
 * zeros a count/quantity shouldn't carry. Never trims the stored precision.
 */
export function toApiQty(scale4: string | null | undefined): string {
  const trimmed = toApiMoney(scale4).replace(/\.?0+$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}
