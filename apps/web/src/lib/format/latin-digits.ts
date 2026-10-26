// What people type or paste on an Arabic keyboard, made into the Latin digits
// every figure in the app is (§4.1). PURE and CLIENT-SAFE. One fold, shared by
// the proposal builder's number boxes, the studio's phone numbers and the
// client's one-time code box.

/** Arabic-Indic (U+0660..9) and Extended Arabic-Indic (U+06F0..9) digits. */
const EASTERN_DIGIT = /[٠-٩۰-۹]/g;
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** `value` with every Eastern Arabic digit folded to its Latin digit; nothing else changes. */
export function latinDigits(value: string): string {
  return value.replace(EASTERN_DIGIT, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO));
  });
}
