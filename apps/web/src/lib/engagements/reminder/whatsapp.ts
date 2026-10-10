// The WhatsApp half of the delivery reminder (Round B, B11): a wa.me deep link
// with the message prefilled. PURE and CLIENT-SAFE. No WhatsApp API, no send on
// our side: the studio's own WhatsApp opens with the text ready, and the studio
// presses send.

/** Arabic-Indic (U+0660..9) and Extended Arabic-Indic (U+06F0..9) digits. */
const EASTERN_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * Invisible marks a pasted number carries: LRM/RLM, the bidi embeddings and
 * isolates WhatsApp's own "copy number" wraps it in, ALM, the zero-width
 * characters and the BOM.
 */
const FORMAT_MARKS = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/** What people type between digits: spaces of every width, dashes, dots, slashes, brackets. */
const PHONE_PUNCTUATION = /[\s\u00A0\u2000-\u200A\u202F\u205F\u3000\-\u2010-\u2015.()[\]/]/g;

/** An Egyptian mobile without its trunk 0: 10, 11, 12 or 15, then 8 digits. */
const EGYPTIAN_MOBILE_NATIONAL = /^1[0125]\d{8}$/;

/** E.164: a country code that does not start with 0, 8 to 15 digits in all. */
const E164_DIGITS = /^[1-9]\d{7,14}$/;

/** Fold Eastern Arabic digits to Latin ones (U+0660 and U+06F0 are both zero). */
function latinDigits(value: string): string {
  return value.replace(EASTERN_DIGIT, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * A typed or pasted number with Latin digits only and nothing between them:
 * Arabic-Indic digits folded, the invisible bidi marks and the punctuation
 * people type removed. A leading + survives, and so do letters, so a caller's
 * own pattern still refuses them. The studio's own numbers are stored in this
 * form (lib/org/client-page-details.ts).
 */
export function compactPhone(phone: string): string {
  return latinDigits(phone).replace(FORMAT_MARKS, '').replace(PHONE_PUNCTUATION, '');
}

/**
 * A number written WITHOUT an international prefix can only be placed if it is
 * an Egyptian mobile: `010…` (trunk 0 kept) and `10…` (trunk 0 dropped, as a
 * spreadsheet import does) both become `2010…`. Anything else is null: wa.me
 * would read its first digits as some other country's code.
 */
function egyptianNational(digits: string): string | null {
  const national = digits.startsWith('0') ? digits.slice(1) : digits;
  return EGYPTIAN_MOBILE_NATIONAL.test(national) ? `20${national}` : null;
}

/**
 * The number in the international, digits-only form wa.me expects, or null
 * when it cannot be one.
 * - `+20 10 1234 5678`, `0020 10 1234 5678`, `+20 010 1234 5678`,
 *   `+20 (0)10 1234 5678`: the country code kept, a trunk 0 after +20 dropped.
 * - `01012345678` and `1012345678` (an Egyptian mobile with or without its
 *   trunk 0): `201012345678`.
 * - Arabic-Indic digits and the invisible bidi marks a pasted number carries
 *   are folded or stripped first.
 * - No +/00 prefix and not an Egyptian mobile (a landline, a foreign number
 *   written nationally): null, it cannot be placed.
 * - Anything that is still not 8 to 15 digits with a country code that does
 *   not start with 0 (a letter, an extension, a scheme): null.
 */
export function whatsappDigits(phone: string | null): string | null {
  if (!phone) return null;
  const compact = compactPhone(phone);
  let digits: string | null;
  if (compact.startsWith('+')) digits = compact.slice(1);
  else if (compact.startsWith('00')) digits = compact.slice(2);
  else digits = egyptianNational(compact);
  if (digits === null) return null;
  // Egypt written with its trunk 0 after the country code: +20 0 10…, +20 (0) 10…
  if (/^200\d/.test(digits)) digits = `20${digits.slice(3)}`;
  return E164_DIGITS.test(digits) ? digits : null;
}

/**
 * The wa.me link. With no number it still opens WhatsApp with the text ready,
 * and the studio picks the chat themselves.
 */
export function whatsappUrl(digits: string | null, text: string): string {
  return `https://wa.me/${digits ?? ''}?text=${encodeURIComponent(text)}`;
}
