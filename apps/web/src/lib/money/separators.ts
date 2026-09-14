/**
 * What a separator INSIDE a money string means.
 *
 * PURE and CLIENT-SAFE, like the reader that uses it. Its own file because the
 * question it answers — is this character grouping, or is it a ten-fold error —
 * is a different question from "what does this string read as", and the answer
 * is the one subtlety in the whole money path.
 */

const ARABIC_NUMERALS_RE = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** Arabic-Indic + Persian digits to Latin, U+066B (Arabic decimal separator) to
 *  '.'. U+066C (Arabic thousands separator) is LEFT IN PLACE — it is a grouping
 *  separator and goes through the same strict check as the comma. */
export function toLatinNumerals(value: string): string {
  return value
    .replace(ARABIC_NUMERALS_RE, (digit) => {
      const code = digit.charCodeAt(0);
      const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(code - base);
    })
    .replace(/\u066B/g, '.');
}

/**
 * Everything a human or a spreadsheet uses to group thousands.
 *
 * A SPACE IS NOT NOISE. Stripping whitespace unconditionally read `'1 5'` as
 * `15` and `'1 2 3'` as `123` — the same ten-fold money error the comma rule
 * exists to prevent, wearing an invisible character. Two of these are invisible
 * (U+00A0, U+202F) and one more is easy to miss (U+066C), which is exactly why
 * each must prove it is in a thousands POSITION before it is removed.
 */
const GROUPING_SEPARATORS = [',', '\u066C', ' ', '\u00A0', '\u202F'];

/** Strict grouping with ONE separator: 1–3 leading digits, then groups of 3. */
function groupedWith(separator: string): RegExp {
  const escaped =
    separator === ','
      ? ','
      : `\\u${separator.charCodeAt(0).toString(16).padStart(4, '0')}`;
  return new RegExp(`^-?\\d{1,3}(${escaped}\\d{3})+(\\.\\d+)?$`);
}

/**
 * Strip grouping separators, or refuse. `null` = refuse.
 *
 * Outer whitespace is trimmed first — leading and trailing space is formatting,
 * not grouping. What is left may use ONE separator, in thousands positions only:
 * a second kind ('1 234,567') is a sheet whose own convention is unclear, and
 * guessing at that is how a rate becomes a thousand times itself.
 */
export function withoutSeparators(value: string): string | null {
  const trimmed = value.trim();
  const used = GROUPING_SEPARATORS.filter((separator) => trimmed.includes(separator));
  if (used.length === 0) return trimmed;
  if (used.length > 1) return null;
  const [separator] = used;
  if (!groupedWith(separator).test(trimmed)) return null;
  return trimmed.split(separator).join('');
}
