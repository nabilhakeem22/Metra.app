// Text normalisation shared by matching (B7, source_labels), the unit map and
// the verbatim cross-check (B12). Pure; no dependency.

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

/** The label an item is matched by: its name and spec, normalised. */
export function sourceLabelOf(labelAr: string, specAr: string | null): string {
  return normalizeArabic(specAr === null ? labelAr : `${labelAr} ${specAr}`);
}

/** '11.10' -> '11.1', '007' -> '7', '5.0' -> '5'. Input must already be a decimal. */
export function canonicalDecimal(decimal: string): string {
  const [whole, fraction = ''] = decimal.split('.');
  const trimmedWhole = whole.replace(/^0+(?=[0-9])/, '');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction === '' ? trimmedWhole : `${trimmedWhole}.${trimmedFraction}`;
}

const DIRECTION_MARKS = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;
const DECIMAL_MARKS = /[.,\u060C\u066B]/g;

/**
 * The number a printed cell holds, as a canonical decimal, or null when the cell
 * is not a single number. The bulletin prints Arabic-Indic digits with a comma
 * as the DECIMAL mark («١٠،٣٧٤» = 10.374) and no thousands separator
 * («٣٩٨٥٠» = 39850), so exactly one mark is read as the decimal point; the
 * Arabic thousands sign (U+066C) is dropped; two marks are refused.
 */
export function verbatimCellNumber(cell: string): string | null {
  const compact = toWesternDigits(cell).replace(DIRECTION_MARKS, '').replace(/\s+/g, '').replace(/\u066C/g, '');
  const marks = compact.match(DECIMAL_MARKS) ?? [];
  if (marks.length > 1) return null;
  const decimal = compact.replace(DECIMAL_MARKS, '.');
  return /^[0-9]+(\.[0-9]+)?$/.test(decimal) ? canonicalDecimal(decimal) : null;
}
