/**
 * The register check's word list and matcher: Egyptian words that have no place
 * in a فصحى string. PURE and dependency-free.
 *
 * WHY A LIST, AND WHY THIS ONE. Every word below is unambiguous عامية: none of
 * them is a فصحى word in another sense, so a hit is never a false alarm. That
 * rules out tempting candidates on purpose:
 *   - دول is listed in the plan as "those", but in فصحى it is دُوَل "countries";
 *     it is excluded so a client string about a country never fails the build.
 *   - Words that are Egyptian only as a PREFIX (ب\u0640 on a present verb, ه\u0640 for the
 *     future, the negating م\u0640...ش) cannot be matched as whole words without
 *     catching بحث / هدف / مشروع, so the gate does not try; style-guide.md and
 *     the human review still own them.
 * The matcher is whole-word (bounded by the string's start or end, whitespace,
 * or punctuation) and runs after the diacritics are stripped, so دَه and ده are
 * the same word and مشروع never matches مش.
 */

export const EGYPTIAN_MARKERS: readonly string[] = [
  'ده',
  'دي',
  'مش',
  'مفيش',
  'دلوقتي',
  'تاني',
  'عشان',
  'علشان',
  'لسه',
  'كده',
  'إيه',
  'ازاي',
  'إزاي',
  'بتاع',
  'بتاعة',
  'اللي',
  'فين',
  'إمتى',
];

const MARKER_SET: ReadonlySet<string> = new Set(EGYPTIAN_MARKERS);

/** Every non-spacing mark (the harakat, shadda, sukun, the dagger alef) and the
 *  tatweel, which stretches a word without changing it. */
const ARABIC_DIACRITICS = /\p{Mn}|\u0640/gu;

/** Anything that is not a letter, a combining mark or a digit separates words. */
const WORD_SEPARATOR = /[^\p{L}\p{M}\p{N}]+/u;

/** The Egyptian marker words a value contains, as whole words, in order. */
export function egyptianMarkersIn(value: string): string[] {
  return value
    .replace(ARABIC_DIACRITICS, '')
    .split(WORD_SEPARATOR)
    .filter((word) => MARKER_SET.has(word));
}
