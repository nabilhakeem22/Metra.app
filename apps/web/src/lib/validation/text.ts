/**
 * Free-text normalisation for action-core input boundaries.
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`, no 'use client'.
 *
 * Both shapes had been hand-copied across the domain cores — `clean` seven times,
 * `optionalText` four times — plus two sites that inlined the trim ladder by hand.
 * They agreed today, which is precisely the danger: one of them tightening a cap
 * and the others staying behind is a silent divergence in what the product accepts
 * as input.
 *
 * Percentages moved to ./percent.ts: free text and percentages are two jobs.
 */

/**
 * How long a string is, in CODE POINTS — the unit Postgres counts, and the unit
 * `optionalText` below already used inline.
 *
 * `.length` counts UTF-16 units, so a description of 251 astral characters
 * measures 502 here and 251 there: refused by the app, accepted by the database.
 * The direction is always SAFE (the app refuses more than the database would
 * truncate), but "refused for being too long" is a lie when the database would
 * have stored it, and a studio pasting a spec with an emoji in it has no way to
 * know why. Arabic text is unaffected either way: one unit per character.
 *
 * One rule, one home. Every cap in the codebase measures through this.
 */
export function countCharacters(text: string): number {
  return [...text].length;
}

/** Trim a nullable free-text field to a stored value: '' / whitespace / null /
 *  undefined all collapse to `null`, so "the user cleared the box" and "the user
 *  never filled it in" reach the database as the same absent value. */
export function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** Characters that take up no visible room: format marks (zero-width space and
 *  joiners, the bidi marks, the word joiner), every kind of space, and the
 *  invisible fillers that are not format marks (they are Mn, So or Lo): the
 *  combining grapheme joiner U+034F, the variation selector U+FE0F, the Hangul
 *  fillers U+115F, U+1160, U+3164 and U+FFA0, and the braille blank U+2800.
 *  The two combining ones stand outside the class: inside it a combining mark
 *  reads as part of the character before it, which the linter refuses. */
const INVISIBLE = /[\p{Cf}\p{Z}\s\u115F\u1160\u2800\u3164\uFFA0]|\u034F|\uFE0F/gu;

/** True when `text` shows at least one character. */
export function hasVisibleCharacter(text: string): boolean {
  return text.replace(INVISIBLE, '') !== '';
}

/** `clean`, and null too when nothing in the value shows (a zero-width space
 *  alone is a blank label, not a name). */
export function visibleText(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  return trimmed !== null && hasVisibleCharacter(trimmed) ? trimmed : null;
}

/** Control characters no box should hold (NUL fails a text column outright,
 *  22021). Tab, line feed and carriage return are not among them: a note may
 *  carry them. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

/** True when `text` holds a control character (a paste out of another app). */
export function hasControlCharacter(text: string): boolean {
  return CONTROL_CHARACTERS.test(text);
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
 * if (note === TOO_LONG) failFields({ note: { code: 'too_long', params: { max: MAX_NOTE_CHARS } } });
 * ```
 */
export function optionalText(
  value: string | null | undefined,
  max: number,
): string | null | TooLong {
  const trimmed = clean(value);
  if (trimmed === null) return null;
  return countCharacters(trimmed) > max ? TOO_LONG : trimmed;
}
