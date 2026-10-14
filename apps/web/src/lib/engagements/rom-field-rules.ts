// The build-cost range the studio types: two positive amounts, low to high.
// Pure and client-safe: the range form checks it on Save and the core again.
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readPositiveAmount } from '@/lib/validation/amount-field';
import { collectFieldErrors, type FieldRead } from '@/lib/validation/field-rules';

export const ROM_FIELDS = ['romLow', 'romHigh'] as const;
export type RomField = (typeof ROM_FIELDS)[number];

const RANGE_INVALID = { ok: false, error: { code: 'rom_range_invalid' } } as const;

/** A strictly positive typed amount at scale 4 (the shared money-box reader). */
function readBandAmount(value: unknown): FieldRead<bigint> {
  const read = readPositiveAmount(value, RANGE_INVALID.error);
  return read.ok ? { ok: true, value: parseMoney4(read.value) } : read;
}

/** The canonical band, or every refusal under its box; a high below the low is
 *  said under the high. */
export function readRomRange(
  input: { romLow: unknown; romHigh: unknown },
): { ok: true; romLow: string; romHigh: string } | { ok: false; errors: FieldErrors<RomField> } {
  const low = readBandAmount(input.romLow);
  const high = readBandAmount(input.romHigh);
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
