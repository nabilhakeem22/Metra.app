/**
 * Free-text and percentage normalisation for action-core input boundaries.
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`, no 'use client'.
 *
 * Every one of these three shapes had been hand-copied across the domain cores —
 * `clean` seven times, `normPct` (with its private `PCT_RE`) three times,
 * `optionalText` four times — plus two sites that inlined the trim ladder by hand.
 * They agreed today, which is precisely the danger: one of them tightening a cap or
 * a regex and the other thirteen staying behind is a silent divergence in what the
 * product accepts as input.
 */

/** Trim a nullable free-text field to a stored value: '' / whitespace / null /
 *  undefined all collapse to `null`, so "the user cleared the box" and "the user
 *  never filled it in" reach the database as the same absent value. */
export function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * The over-length signal from {@link optionalText}. A distinct `unique symbol`
 * rather than `null`, because the two outcomes must not be confused: `null` means
 * "absent, store nothing", while this means "present but refuse the whole call".
 * Returning `null` for an over-long note would silently DISCARD what the user typed.
 */
export const TOO_LONG: unique symbol = Symbol('TOO_LONG');
export type TooLong = typeof TOO_LONG;

/** Cap for free-text notes. Matches `left(p_note, 2000)` in the SECURITY DEFINER
 *  functions, so the app refuses exactly what the database would have truncated. */
export const MAX_NOTE_CHARS = 2000;

/** Cap for short labels (names, titles, codes-as-labels), mirroring the `name: 200`
 *  boundary the domain cores already enforce. */
export const MAX_LABEL_CHARS = 200;

/**
 * Trim an optional free-text field and refuse it if it exceeds `max` CODE POINTS
 * after trimming (so trailing whitespace never pushes a legal value over the cap).
 *
 * Code points, not UTF-16 units, because the cap mirrors `left(p_note, 2000)` in
 * the SECURITY DEFINER functions and Postgres counts characters. `.length` counts
 * units, so 1,001 emoji — 2,002 units, 1,001 characters — were refused here and
 * would have been accepted there. The direction was always safe (this refused
 * MORE than the database would truncate), but the two numbers now mean the same
 * thing. Arabic text is unaffected either way: it is one unit per character.
 *
 * Call site:
 * ```ts
 * const note = optionalText(input.note, MAX_NOTE_CHARS);
 * if (note === TOO_LONG) return fail('invalid');
 * ```
 */
export function optionalText(
  value: string | null | undefined,
  max: number,
): string | null | TooLong {
  const trimmed = clean(value);
  if (trimmed === null) return null;
  return [...trimmed].length > max ? TOO_LONG : trimmed;
}

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
  blank: string = '0',
): string | null {
  const trimmed = clean(value);
  if (trimmed === null) return blank;
  if (!PERCENT_RE.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return trimmed;
}

/** Unsigned decimal, no exponent, no sign, no separators. Anchored at both ends. */
const PERCENT_RE = /^\d+(\.\d+)?$/;
