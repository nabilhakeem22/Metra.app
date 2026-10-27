// The ONE canonical form of a sign-in identifier (go-live security fix round,
// T5). PURE and CLIENT-SAFE. Both OTP routes canonicalize the parsed request
// once (otp-route.ts), so the per-address throttle key (otp-throttle.ts) and
// the value Supabase receives (otp.ts) are the same string and cannot diverge:
// a spelling that reaches Supabase as one person is one bucket.
import { latinDigits } from '@/lib/format/latin-digits';
import { normalizeEmail } from '@/lib/validation/email';
import type { OtpChannel } from './otp-field-rules';

/**
 * Email: trimmed and lower-cased. Phone: `+` and its digits only, Arabic-Indic
 * digits folded to Latin, so `+20 100-123 4567` is `+201001234567`; a phone
 * with no digit at all is '' (the identifier pre-check then says required).
 */
export function canonicalOtpIdentifier(channel: OtpChannel, identifier: string): string {
  if (channel === 'email') return normalizeEmail(identifier);
  const digits = latinDigits(identifier).replace(/\D/g, '');
  return digits === '' ? '' : `+${digits}`;
}
