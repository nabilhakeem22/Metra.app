// The WhatsApp half of the delivery reminder (Round B, B11): a wa.me deep link
// with the message prefilled. PURE and CLIENT-SAFE. No WhatsApp API, no send on
// our side: the studio's own WhatsApp opens with the text ready, and the studio
// presses send.

/** Characters people type inside a phone number that are not part of it. */
const PHONE_PUNCTUATION = /[\s\-.()[\]/]/g;

/**
 * The number in the international, digits-only form wa.me expects, or null
 * when it cannot be one.
 * - `+20 10 1234 5678` and `0020 10 1234 5678`: the country code is kept.
 * - `01012345678` (an Egyptian mobile, 11 digits): becomes `201012345678`.
 * - Anything left with a leading 0 (a local number we cannot place), a
 *   non-digit, or outside 8 to 15 digits (E.164): null.
 */
export function whatsappDigits(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(PHONE_PUNCTUATION, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (/^01\d{9}$/.test(digits)) digits = `20${digits.slice(1)}`;
  if (!/^\d{8,15}$/.test(digits) || digits.startsWith('0')) return null;
  return digits;
}

/**
 * The wa.me link. With no number it still opens WhatsApp with the text ready,
 * and the studio picks the chat themselves.
 */
export function whatsappUrl(digits: string | null, text: string): string {
  return `https://wa.me/${digits ?? ''}?text=${encodeURIComponent(text)}`;
}
