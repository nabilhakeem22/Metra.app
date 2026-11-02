// A sign-in phone number as typed, made into what Supabase receives (go-live
// security fix round 2, F2). PURE and CLIENT-SAFE: the sign-in form and both
// OTP routes read it, so the form refuses exactly what the server would.
//
// Only FORMATTING is dropped (spaces, dashes, dots, brackets). Anything else
// that is not a digit or the one leading `+` makes the number unreadable:
// deleting a typed letter O would text a code to a DIFFERENT number.
import { latinDigits } from '@/lib/format/latin-digits';

const PHONE_FORMATTING = /[\s\-.()]/g;

/** One optional leading `+`, then digits only. */
const PLAIN_PHONE_NUMBER = /^\+?(\d+)$/;

/** `typed` as `+` and its digits (Arabic-Indic digits folded to Latin), or null when it is not a phone number. */
export function phoneNumberOf(typed: string): string | null {
  const plain = PLAIN_PHONE_NUMBER.exec(latinDigits(typed).replace(PHONE_FORMATTING, ''));
  return plain ? `+${plain[1]}` : null;
}
