/**
 * Bidi isolation for values embedded in prose of the opposite direction.
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`, no 'use client'. It exists
 * because Metra renders Arabic (RTL) prose around values that are always Western
 * LTR — dates, money, document numbers — and the Unicode bidi algorithm will happily
 * reorder an unisolated `31/08/2026` into `2026/08/31` when it sits inside an RTL
 * run. Isolating the value pins its own direction without affecting the sentence.
 */

/** U+2068 FIRST STRONG ISOLATE — opens a run whose direction is taken from its own
 *  first strong character rather than from the surrounding paragraph. */
const FIRST_STRONG_ISOLATE = '⁨';

/** U+2069 POP DIRECTIONAL ISOLATE — closes the run opened above. */
const POP_DIRECTIONAL_ISOLATE = '⁩';

/**
 * Wrap a value so the bidi algorithm cannot reorder it inside surrounding prose.
 * Use it on every LTR value interpolated into an Arabic string — a date, an amount,
 * a reference number. Harmless in LTR locales (the isolate is invisible and the
 * direction is unchanged), so it does not need to be conditional on locale.
 */
export function bidiIsolate(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}
