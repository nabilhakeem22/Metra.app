import 'server-only';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OtpChannel } from './otp-field-rules';

/**
 * The two fields of a Supabase AuthError this app reads. NEVER its message: the
 * provider's text can echo the address that was typed, and a log line is not
 * where a person's email belongs.
 */
export interface AuthFailure {
  code?: string;
  status?: number;
}

/** The typed address is the problem: said under the box it was typed in. */
function identifierRefused(channel: OtpChannel): ActionResult {
  return channel === 'email'
    ? fieldsFailed({ email: { code: 'email_format' } })
    : fieldsFailed({ phone: { code: 'phone_invalid' } });
}

const RATE_LIMITED = ['over_email_send_rate_limit', 'over_sms_send_rate_limit', 'over_request_rate_limit'];

/** Supabase error codes a person can act on, and what each one tells them. */
const SEND_ANSWERS: Readonly<Record<string, (channel: OtpChannel) => ActionResult>> = {
  ...Object.fromEntries(RATE_LIMITED.map((code) => [code, () => err('otp_rate_limited')])),
  email_address_invalid: identifierRefused,
  validation_failed: identifierRefused,
  phone_provider_disabled: () => err('otp_sms_unavailable'),
  sms_send_failed: () => err('otp_sms_unavailable'),
  email_address_not_authorized: () => err('otp_email_unavailable'),
  email_provider_disabled: () => err('otp_email_unavailable'),
};

/** A wrong code and an expired one are one answer: Supabase says otp_expired for both (D8). */
const VERIFY_ANSWERS: Readonly<Record<string, () => ActionResult>> = {
  ...Object.fromEntries(RATE_LIMITED.map((code) => [code, () => err('otp_verify_rate_limited')])),
  otp_expired: () => fieldsFailed({ token: { code: 'otp_verify_failed' } }),
};

function answerFor<A>(answers: Readonly<Record<string, A>>, code: string | undefined): A | undefined {
  return code !== undefined && Object.hasOwn(answers, code) ? answers[code] : undefined;
}

/**
 * One log line per failure, carrying the Supabase `code` and HTTP `status` only.
 * A cause the person can act on is answered by name; anything else is the
 * referenced `generic` (its status rides in the whitelisted `message` slot).
 */
function answer(label: string, failure: AuthFailure, known: (() => ActionResult) | undefined): ActionResult {
  if (!known) {
    return unexpectedFailure(label, {
      name: 'AuthError',
      code: failure.code,
      message: `status ${failure.status ?? 'unknown'}`,
    });
  }
  console.error(label, { code: failure.code, status: failure.status });
  return known();
}

export function otpSendFailure(label: string, failure: AuthFailure, channel: OtpChannel): ActionResult {
  const known = answerFor(SEND_ANSWERS, failure.code);
  return answer(label, failure, known && (() => known(channel)));
}

export function otpVerifyFailure(label: string, failure: AuthFailure): ActionResult {
  return answer(label, failure, answerFor(VERIFY_ANSWERS, failure.code));
}
