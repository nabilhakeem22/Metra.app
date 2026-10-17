// Text normalisation shared by matching (B7, source_labels), the unit map and
// the verbatim cross-check (B12). The Arabic folding itself is the seed's too
// (@metra/db/market-seed), so a label and a seeded name fold alike.
import { normalizeArabic, toWesternDigits } from '@metra/db/market-seed';

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
