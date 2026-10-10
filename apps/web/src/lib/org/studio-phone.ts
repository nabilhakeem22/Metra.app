// The studio's own phone and WhatsApp numbers, as the client page dials them
// (Round C, C8 fix round F2). PURE and CLIENT-SAFE. One rule for both, and it is
// B11's (lib/engagements/reminder/whatsapp.ts): a number with an international
// prefix is folded the way wa.me needs it (Arabic-Indic digits, bidi marks and
// punctuation gone, the Egyptian trunk 0 after +20 dropped, so "+20 (0)10 ...",
// "+20 010 ...", "00 20 0 10 ..." and "+0020 10 ..." are all +2010...), and a
// number without one must be a dialable Egyptian number. What is stored always
// rings from a `tel:` link.
import { compactPhone, whatsappDigits } from '@/lib/engagements/reminder/whatsapp';

/** An Egyptian number with its trunk 0: a mobile (11 digits) or a landline (9 or 10). */
const EGYPTIAN_NATIONAL = /^0[1-9]\d{7,9}$/;

/** An Egyptian mobile written without its trunk 0, as a spreadsheet import does. */
const EGYPTIAN_MOBILE_WITHOUT_TRUNK = /^1[0125]\d{8}$/;

/**
 * The number as 0058 stores it, or null when no phone could ring it: `+` and
 * the international digits (a country code that does not start with 0, 8 to
 * 15 digits in all), or an Egyptian national number with its trunk 0.
 */
export function studioPhoneOf(text: string): string | null {
  const compact = compactPhone(text).replace(/^\+00/, '+');
  if (compact.startsWith('+') || compact.startsWith('00')) {
    const digits = whatsappDigits(compact);
    return digits ? `+${digits}` : null;
  }
  if (EGYPTIAN_NATIONAL.test(compact)) return compact;
  return EGYPTIAN_MOBILE_WITHOUT_TRUNK.test(compact) ? `0${compact}` : null;
}

/** Whether wa.me can open a chat with a number `studioPhoneOf` produced (not a landline). */
export function reachableOnWhatsapp(phone: string): boolean {
  return whatsappDigits(phone) !== null;
}
