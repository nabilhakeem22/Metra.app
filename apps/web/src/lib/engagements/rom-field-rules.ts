// The build-cost range the studio types: two positive amounts, low to high.
// Pure and client-safe: the range form checks it on Save and the core again.
import { MONEY_RE, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors, type FieldRead } from '@/lib/validation/field-rules';

export const ROM_FIELDS = ['romLow', 'romHigh'] as const;
export type RomField = (typeof ROM_FIELDS)[number];

/**
 * The longest money string this system can mean: `numeric(18,4)` is 14 integer
 * digits and 4 decimals, so 19 characters plus a point.
 *
 * `MONEY_RE` bounds the SHAPE and not the LENGTH, so without this a megabyte of
 * digits -- the server-action body limit, not the field's -- reaches `BigInt`
 * before `numeric(18,4)` rejects it downstream. Cheap to send, not free to parse.
 */
const MAX_MONEY_CHARS = 20;

const RANGE_INVALID = { ok: false, error: { code: 'rom_range_invalid' } } as const;

/** A well-formed money string whose value is strictly positive, at scale 4. */
function readPositiveAmount(value: unknown): FieldRead<bigint> {
  if (typeof value !== 'string') return RANGE_INVALID;
  const trimmed = value.trim();
  if (trimmed.length > MAX_MONEY_CHARS || !MONEY_RE.test(trimmed)) return RANGE_INVALID;
  const amount = parseMoney4(trimmed);
  return amount > 0n ? { ok: true, value: amount } : RANGE_INVALID;
}

/** The canonical band, or every refusal under its box; a high below the low is
 *  said under the high. */
export function readRomRange(
  input: { romLow: unknown; romHigh: unknown },
): { ok: true; romLow: string; romHigh: string } | { ok: false; errors: FieldErrors<RomField> } {
  const low = readPositiveAmount(input.romLow);
  const high = readPositiveAmount(input.romHigh);
  if (!low.ok || !high.ok) {
    return {
      ok: false,
      errors: collectFieldErrors({
        romLow: low.ok ? null : low.error,
        romHigh: high.ok ? null : high.error,
      }),
    };
  }
  if (high.value < low.value) return { ok: false, errors: { romHigh: RANGE_INVALID.error } };
  return { ok: true, romLow: formatMoney4(low.value), romHigh: formatMoney4(high.value) };
}

export function romFieldErrors(input: { romLow: string; romHigh: string }): FieldErrors<RomField> {
  const read = readRomRange(input);
  return read.ok ? {} : read.errors;
}
