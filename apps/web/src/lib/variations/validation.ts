// Variation-order input validation — PURE and CLIENT-SAFE (no db, no
// `server-only`), mirroring lib/proposals/validation.ts so the money rules
// standing between a pasted string and a numeric(18,4) column are unit-testable
// without a database.
import { MONEY_RE, clampMoney4 } from '@/lib/aggregates/proposal-totals';

/**
 * Signed money string (a VO qty may be NEGATIVE for a de-scope), or null if
 * malformed. Absent/empty means 0.
 *
 * Clamped to 4dp exactly like normalizeMoney: the app truncates past the 4th
 * decimal while numeric(18,4) rounds, so an unclamped value is computed at one
 * number and stored at another.
 */
export function normalizeSignedMoney(
  v: string | null | undefined,
): string | null {
  const s = v?.trim();
  if (s === undefined || s === '') return '0';
  if (!MONEY_RE.test(s)) return null;
  return clampMoney4(s);
}
