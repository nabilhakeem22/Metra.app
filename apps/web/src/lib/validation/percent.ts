/**
 * Percentage normalisation for action-core input boundaries.
 *
 * PURE and CLIENT-SAFE: no `server-only`, no 'use client', no db import.
 *
 * Split out of ./text.ts, which had grown two unrelated jobs (free text, and
 * percentages) — and out of `lib/proposals/validation.ts`, which held a SECOND,
 * separately-written predicate over the same [0,100] rule. One regex, one range
 * check, two names: `normalizePercent` for the value, `isPercentInRange` for the
 * guard. They cannot drift, because the predicate is defined in terms of the
 * normaliser.
 */
import { clean } from './text';

/** Unsigned decimal, no exponent, no sign, no separators. Anchored at both ends. */
const PERCENT_RE = /^\d+(\.\d+)?$/;

/**
 * A non-negative percentage in [0, 100] as a decimal string, or `null` if the input
 * is not one. Absent input (null / undefined / '' / whitespace) yields `blank`,
 * which defaults to `'0'` because every current call site stores a zero rather than
 * a NULL percentage.
 *
 * The shape is checked with a regex BEFORE `Number()` is ever consulted, and that
 * ordering is the whole point: `Number()` happily accepts `'1e2'` (→ 100),
 * `'0x1A'` (→ 26), `' 5 '` and `''` (→ 0). Accepting any of those would let a
 * value that is not a decimal percentage string reach a `numeric` column whose
 * CHECK constraint then raises 23514 at write time instead of returning a coded
 * error. The regex refuses all four; the range check then refuses 100.0001.
 */
export function normalizePercent(
  value: string | null | undefined,
  blank: string | null = '0',
): string | null {
  const trimmed = clean(value);
  if (trimmed === null) return blank;
  if (!PERCENT_RE.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return trimmed;
}

/**
 * True when `value` is a decimal percentage string in [0, 100].
 *
 * The predicate form of {@link normalizePercent} — same regex, same range check,
 * ONE definition. Absent input is NOT in range here (the caller has already
 * decided the field is present), which is why `blank` is pinned to `null`.
 */
export function isPercentInRange(value: string): boolean {
  return normalizePercent(value, null) !== null;
}
