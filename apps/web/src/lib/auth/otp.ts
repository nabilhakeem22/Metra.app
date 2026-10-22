import 'server-only';
import { fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { ok, type ActionResult } from '@/lib/actions/result';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OtpSendRequest, OtpVerifyRequest, OtpVerifyResult, PostLoginPath } from './otp-contract';
import { otpSendFailure, otpVerifyFailure } from './otp-failure';
import { otpCodeErrors, otpIdentifierErrors, type OtpChannel } from './otp-field-rules';
import { postLoginPathFor } from './post-login-path';

// The sign-in code cores behind app/api/auth/otp/{send,verify}.
//
// Coded results only: the client localizes via describeFailure, and a refusal
// about the typed address or code comes back under that box. Supabase's own
// error text is never returned and never logged (it can echo the address);
// otp-failure.ts logs its code and HTTP status only.

/** The pre-check the form already ran, run again on what arrived. */
function identifierRefusal(channel: OtpChannel, identifier: string): ActionResult | null {
  const errors = otpIdentifierErrors(channel, identifier);
  return hasFieldErrors(errors) ? fieldsFailed(errors) : null;
}

function codeRefusal(token: string): ActionResult | null {
  const errors = otpCodeErrors(token);
  return hasFieldErrors(errors) ? fieldsFailed(errors) : null;
}

/** Ask Supabase to send a sign-in code by email, or by SMS (site engineers). */
export async function sendOtpCore({ channel, identifier }: OtpSendRequest): Promise<ActionResult> {
  const refused = identifierRefusal(channel, identifier);
  if (refused) return refused;
  const supabase = await createSupabaseServerClient();
  if (channel === 'email') {
    const { error } = await supabase.auth.signInWithOtp({
      email: identifier,
      options: { shouldCreateUser: true },
    });
    return error ? otpSendFailure('sendEmailOtp failed', error, 'email') : ok();
  }
  const { error } = await supabase.auth.signInWithOtp({ phone: identifier });
  return error ? otpSendFailure('sendPhoneOtp failed', error, 'phone') : ok();
}

/**
 * Check a typed code. On success Supabase writes the session cookies, and the
 * answer names where to go next, so the form needs no second round trip.
 */
export async function verifyOtpCore({ channel, identifier, token }: OtpVerifyRequest): Promise<OtpVerifyResult> {
  const refused = codeRefusal(token);
  if (refused) return refused;
  const supabase = await createSupabaseServerClient();
  const { data, error } =
    channel === 'email'
      ? await supabase.auth.verifyOtp({ email: identifier, token, type: 'email' })
      : await supabase.auth.verifyOtp({ phone: identifier, token, type: 'sms' });
  if (error) return otpVerifyFailure(channel === 'email' ? 'verifyEmailOtp failed' : 'verifyPhoneOtp failed', error);
  return { ok: true, next: await nextPathFor(data.user?.id) };
}

async function nextPathFor(userId: string | undefined): Promise<PostLoginPath> {
  if (userId) return postLoginPathFor(userId);
  // Like a failed membership probe, this must never block the sign-in:
  // requireOrg on /dashboard re-resolves the real destination.
  console.error('verifyOtp returned no user');
  return '/dashboard';
}
