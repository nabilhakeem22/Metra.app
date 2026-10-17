// The Arabic folding every market label and seeded name is compared in: the
// bulletin gate's matching (packages/market-ingest) and the price-book seed
// (./compare.ts) read the same one. Pure; no dependency.

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** ٠..٩ and ۰..۹ to 0..9; every other character unchanged. */
export function toWesternDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero = code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - zero);
  });
}

/**
 * The matching form of an Arabic label: أ/إ/آ -> ا, ة -> ه, ى -> ي, no tatweel,
 * no diacritics (any non-spacing mark), Western digits, one space between words.
 */
export function normalizeArabic(text: string): string {
  return toWesternDigits(text)
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0640|\p{Mn}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
