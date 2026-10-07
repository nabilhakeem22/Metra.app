// What a studio TYPES into a number box, made into what the money parser reads.
// PURE and CLIENT-SAFE. The server's parser stays strict (Latin digits, one dot);
// this runs in the builder only, so the live preview and the saved payload read
// the same number the user meant:
//   - Arabic-Indic digits (٠-٩, ۰-۹) and the Arabic decimal mark (٫) become Latin;
//   - a comma is a thousands separator ONLY in well-formed groups of three
//     ("1,000" and "12,500.5"); "1,5" is left alone and stays invalid, never 15;
//   - a trailing dot from typing "1." mid-number is dropped.
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const ARABIC_DECIMAL_SEPARATOR = '٫';
const ARABIC_THOUSANDS_SEPARATOR = '٬';
const THOUSANDS_GROUPED = /^\d{1,3}(,\d{3})+(\.\d*)?$/;
const TRAILING_DOT = /^\d+\.$/;

function latinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero = code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - zero);
  });
}

export function normalizeDecimalInput(raw: string): string {
  let value = latinDigits(raw.trim())
    .replaceAll(ARABIC_DECIMAL_SEPARATOR, '.')
    .replaceAll(ARABIC_THOUSANDS_SEPARATOR, ',');
  if (THOUSANDS_GROUPED.test(value)) value = value.replaceAll(',', '');
  if (TRAILING_DOT.test(value)) value = value.slice(0, -1);
  return value;
}
