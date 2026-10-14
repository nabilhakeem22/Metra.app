// What the sign-in form checks before it asks for a code, and before it sends
// one back. Pure and client-safe: the form and the auth actions run the same
// rules, so the sentence under the box is the one the server would answer.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { isValidEmail, normalizeEmail } from '@/lib/validation/email';

export const OTP_LENGTH = 6;

/** How a code is sent: the identifier box takes an email or a phone number. */
export type OtpChannel = 'email' | 'phone';

/** The paths a sign-in refusal can name: the identifier (by channel) or the code. */
export type OtpField = OtpChannel | 'token';

export function otpIdentifierErrors(channel: OtpChannel, identifier: string): FieldErrors<OtpField> {
  const typed = identifier.trim();
  if (typed === '') return { [channel]: { code: 'required' } };
  if (channel === 'email' && !isValidEmail(normalizeEmail(typed))) {
    return { email: { code: 'email_format' } };
  }
  return {};
}

export function otpCodeErrors(code: string): FieldErrors<OtpField> {
  return code.length < OTP_LENGTH ? { token: { code: 'too_short', params: { min: OTP_LENGTH } } } : {};
}
