// The rules an invitation's typed address keeps. Pure and client-safe: the
// Team page runs them before sending, the invite action again on what arrived.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { isValidEmail, normalizeEmail } from '@/lib/validation/email';
import { countCharacters } from '@/lib/validation/text';

/** The paths an invite refusal can name. The role comes from a select: a role
 *  no select offers is `malformed`, never a field error. */
export const INVITE_FIELDS = ['email'] as const;

export type InviteField = (typeof INVITE_FIELDS)[number];

/** The longest address the mail standards allow. */
const EMAIL_MAX = 254;

function emailRefusal(email: string): FieldError | null {
  if (email === '') return { code: 'required' };
  if (countCharacters(email) > EMAIL_MAX) return { code: 'too_long', params: { max: EMAIL_MAX } };
  return isValidEmail(email) ? null : { code: 'email_format' };
}

/** What is wrong with the typed address, under the Email box. */
export function inviteFieldErrors(input: { email: string }): FieldErrors<InviteField> {
  return collectFieldErrors<InviteField>({ email: emailRefusal(normalizeEmail(input.email)) });
}
