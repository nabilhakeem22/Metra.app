import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/pg-core';

// The CHECKs on what the client page shows about the studio: its phone and
// WhatsApp, and how to pay it (0058, the phone and printable rules tightened by
// 0059). The app normalises every value before it writes
// (apps/web/src/lib/org/client-page-details.ts), so these are the database's
// second word: each one may be LOOSER than the app, never stricter, or a
// Settings save the app accepted would fail with 23514.
//
// Every character class is spelled code point by code point so no rule depends
// on the database locale.

/**
 * Unicode format characters (category Cf: zero-width and bidirectional
 * controls). A bank name copied with one of these can read differently from
 * what is stored.
 */
export const FORMAT_CHARACTERS = String.raw`\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F`;

/** Unicode white space. */
const WHITE_SPACE = String.raw`\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF`;

/** C0, DEL and C1 controls (NUL cannot be stored at all). */
const CONTROLS = String.raw`\u0001-\u001F\u007F-\u009F`;

/** NEL, then the letters and symbols that draw nothing: the Braille blank and the Hangul fillers. */
const BLANK_LOOKING = String.raw`\u0085\u2800\u115F\u1160\u3164\uFFA0`;

/** Combining marks of the listed scripts, which draw nothing on their own (Latin, Cyrillic, Arabic and the generic blocks). */
const COMBINING_MARKS = String.raw`\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F`;

/**
 * Marks that only select or fill (Round D review): the Khmer inherent vowels,
 * the Mongolian variation selectors, the variation selectors and their
 * supplement, the Egyptian hieroglyph mirror and the Khitan filler.
 */
const FILLERS_AND_SELECTORS = String.raw`\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF`;

/** Private use (the BMP area and planes 15 and 16) and the noncharacters: nothing a font is bound to draw. */
const PRIVATE_USE_AND_NONCHARACTERS = String.raw`\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF`;

/**
 * What a reader cannot see on its own. INVARIANT (organizations-checks.test.ts):
 * only white space, controls, format characters, marks, private use,
 * noncharacters and the blank-looking characters above, never another letter,
 * digit, punctuation mark or symbol. The app keeps a value only when it holds
 * one of those, so every value it accepts passes the visible-character rule
 * (delivery-db-step-0059-differential.dbtest.ts checks every code point).
 */
export const NOT_VISIBLE = `${WHITE_SPACE}${BLANK_LOOKING}${COMBINING_MARKS}${FILLERS_AND_SELECTORS}${PRIVATE_USE_AND_NONCHARACTERS}`;

/** `+` and the international digits: a country code that does not start with 0, 8 to 15 digits. */
const INTERNATIONAL_NUMBER = String.raw`^\+[1-9][0-9]{7,14}$`;

/** An Egyptian number with its trunk 0: a mobile (11 digits) or a landline (9 or 10). */
const EGYPTIAN_NATIONAL_NUMBER = String.raw`^0[1-9][0-9]{7,9}$`;

/** An Egyptian mobile with its trunk 0, the only national number WhatsApp can open. */
const EGYPTIAN_MOBILE_NUMBER = String.raw`^01[0125][0-9]{8}$`;

/** The free-text payment columns a client copies into a banking app. */
const PRINTABLE_PAYMENT_TEXT = ['instapay_address', 'bank_name', 'bank_account_holder'];

/** No format character, no control, and one visible character. */
function printableText(column: string): string {
  return `(${column} IS NULL OR (${column} !~ '[${FORMAT_CHARACTERS}]' AND ${column} !~ '[${CONTROLS}]' AND ${column} ~ '[^${NOT_VISIBLE}]'))`;
}

/** Each client-page CHECK by name, as the SQL text 0058 and 0059 write. */
export const CLIENT_PAGE_CHECKS = {
  organizations_studio_phone_format: `studio_phone IS NULL OR studio_phone ~ '${INTERNATIONAL_NUMBER}' OR studio_phone ~ '${EGYPTIAN_NATIONAL_NUMBER}'`,
  organizations_studio_whatsapp_format: `studio_whatsapp IS NULL OR studio_whatsapp ~ '${INTERNATIONAL_NUMBER}' OR studio_whatsapp ~ '${EGYPTIAN_MOBILE_NUMBER}'`,
  organizations_instapay_address_length:
    'instapay_address IS NULL OR char_length(instapay_address) BETWEEN 3 AND 100',
  organizations_bank_text_length:
    '(bank_name IS NULL OR char_length(bank_name) BETWEEN 2 AND 120) AND (bank_account_holder IS NULL OR char_length(bank_account_holder) BETWEEN 2 AND 120)',
  organizations_bank_account_number_format:
    "bank_account_number IS NULL OR (bank_account_number ~ '^[0-9A-Za-z-]{4,34}$' AND bank_account_number ~ '[0-9]')",
  organizations_bank_iban_format: "bank_iban IS NULL OR bank_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'",
  // An account number or IBAN the client cannot name a bank for is refused.
  organizations_bank_account_needs_bank:
    '(bank_account_number IS NULL AND bank_iban IS NULL) OR bank_name IS NOT NULL',
  organizations_payment_text_printable: PRINTABLE_PAYMENT_TEXT.map(printableText).join(' AND '),
} as const;

/** The client-page CHECKs as drizzle table extras. */
export function clientPageChecks() {
  return Object.entries(CLIENT_PAGE_CHECKS).map(([name, expression]) => check(name, sql.raw(expression)));
}
