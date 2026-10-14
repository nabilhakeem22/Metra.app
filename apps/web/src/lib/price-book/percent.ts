// The bulk price-change percentage validator. PURE and CLIENT-SAFE: the same
// shape gate the rest of the money path uses, kept here so the rule that stands
// between a pasted string and a numeric multiply is unit-testable on its own.
import type { FieldError } from '@/lib/actions/field-errors';
import { MONEY_RE } from '@/lib/aggregates/proposal-totals';

/** A bulk change may not wipe more than the whole price, nor multiply it by 11. */
export const BULK_PCT_MIN = -100;
export const BULK_PCT_MAX = 1000;

/**
 * A usable bulk percentage: a plain decimal string inside [-100, 1000].
 *
 * SHAPE FIRST, then range. `Number()` alone reads '1e2' as 100, '0x1A' as 26,
 * ' 5 ' as 5 and '' as 0, so a percentage that never looked like a number was
 * coerced into one and then interpolated into a SQL numeric literal. MONEY_RE
 * accepts only the decimal spelling, so every one of those is refused before the
 * range is even considered — and the string that passes is the string that is
 * safe to hand to Postgres verbatim.
 */
export function isBulkPercent(value: unknown): value is string {
  if (typeof value !== 'string' || !MONEY_RE.test(value)) return false;
  const parsed = Number(value);
  return (
    Number.isFinite(parsed) && parsed >= BULK_PCT_MIN && parsed <= BULK_PCT_MAX
  );
}

/** Why `value` is not a usable bulk percentage, as the refusal under its box. */
export function bulkPercentError(value: unknown): FieldError | null {
  if (isBulkPercent(value)) return null;
  if (typeof value !== 'string' || value.trim() === '') return { code: 'required' };
  return MONEY_RE.test(value)
    ? { code: 'out_of_range', params: { min: BULK_PCT_MIN, max: BULK_PCT_MAX } }
    : { code: 'not_a_number' };
}
