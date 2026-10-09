/**
 * The register check's word list and matcher: Egyptian words that have no place
 * in a فصحى string. PURE and dependency-free.
 *
 * WHY A LIST, AND WHY THIS ONE. Every word below is عامية in any client
 * sentence. Two tempting candidates are left out on purpose, because they are
 * everyday فصحى too and a client string may well use them:
 *   - دول: in فصحى it is دُوَل "countries";
 *   - بقى: فصحى بقي / بقى "remained" ("ما بقي من المبلغ"), which the ى/ي folding
 *     below would otherwise catch.
 * Three listed words have a rare فصحى sense (زي "attire", كمان "violin", خلاص
 * "salvation"); none reads that way in a client page, so they stay.
 *
 * HOW A WORD IS MATCHED. The value is normalised first, the same way for the
 * list and the text: every format character (zero-width space and joiners, the
 * bidi marks) and every non-spacing mark (harakat, shadda, sukun) and the tatweel
 * are removed; ى is folded to ي and أ/إ/آ/ٱ to ا. The text is split into words
 * at anything that is not a letter or a digit, and a word matches when it, or the
 * word without one attached و or ف, is on the list. So «دى», «اللى», «ايه»,
 * «وده», «مـش» and «م‌ش» all match, and «مشروع» or «ديكور» never do.
 *
 * Prefix-only Egyptian forms (بـ on a present verb, هـ for the future, the
 * negating مـ...ش) cannot be matched as whole words without catching بحث / هدف /
 * مشروع, so the gate does not try; style-guide.md and the human review own them.
 */

export const EGYPTIAN_MARKERS: readonly string[] = [
  'ده', 'دي', 'مش', 'مفيش', 'مافيش', 'دلوقتي', 'تاني', 'عشان', 'علشان', 'لسه',
  'كده', 'كدا', 'إيه', 'ازاي', 'إزاي', 'إمتى', 'فين', 'ليه', 'اللي', 'بس',
  'عايز', 'عايزة', 'عايزين', 'زي', 'كمان', 'خلاص', 'معلش', 'بتاع', 'بتاعة',
  'بتاعت', 'بتاعي', 'بتاعك', 'بتاعه', 'بتاعها', 'بتاعنا', 'بتاعكم', 'بتاعهم',
  'بتاعتك', 'بتوع',
];

/** Transliterations that contain a listed word but are not Egyptian: removed
 *  from the text before matching. */
export const EGYPTIAN_MARKER_ALLOWLIST: readonly string[] = ['دي لوكس', 'سي دي', 'دي جي'];

const FORMAT_AND_MARKS = /[\p{Cf}\p{Mn}\u0640]/gu;
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

/** The normal form both the list and the text are compared in. */
export function normaliseArabic(text: string): string {
  return text
    .replace(FORMAT_AND_MARKS, '')
    .replace(/ى/g, 'ي')
    .replace(/[أإآٱ]/g, 'ا');
}

const MARKER_SET: ReadonlySet<string> = new Set(EGYPTIAN_MARKERS.map(normaliseArabic));
const ALLOWLIST: readonly string[] = EGYPTIAN_MARKER_ALLOWLIST.map(normaliseArabic);

/** A word, or the same word without one attached و or ف, on the list. */
function markerOf(word: string): string | null {
  if (MARKER_SET.has(word)) return word;
  const bare = /^[وف]/.test(word) && word.length > 2 ? word.slice(1) : null;
  return bare && MARKER_SET.has(bare) ? bare : null;
}

/** The Egyptian marker words a value contains, as whole words, in order. */
export function egyptianMarkersIn(value: string): string[] {
  const text = ALLOWLIST.reduce((current, phrase) => current.split(phrase).join(' '), normaliseArabic(value));
  return text
    .split(WORD_SEPARATOR)
    .map(markerOf)
    .filter((marker): marker is string => marker !== null);
}
