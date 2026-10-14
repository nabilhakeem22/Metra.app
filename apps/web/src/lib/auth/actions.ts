'use server';

import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { ok, type ActionResult } from '@/lib/actions/result';
import { withUserContext } from '@/lib/db/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { otpSendFailure, otpVerifyFailure } from './otp-failure';
import { otpCodeErrors, otpIdentifierErrors, type OtpChannel } from './otp-field-rules';
import { getSessionUser } from './session';

// Single source of the result type (A4). Re-exported for back-compat imports.
export type { ActionResult };

/**
 * Where to send a user right after login: their dashboard if they belong to at
 * least one org, otherwise onboarding. Membership resolved server-side via the
 * SECURITY DEFINER fn (scoped to the caller).
 */
export async function resolvePostLoginPath(): Promise<string> {
  const user = await getSessionUser();
  if (!user) return '/login';
  try {
    const orgs = (await withUserContext(user.id, (tx) =>
      tx.execute(sql`select 1 from public.app_current_user_orgs() limit 1`),
    )) as unknown as unknown[];
    return orgs.length > 0 ? '/dashboard' : '/onboarding';
  } catch (err) {
    // This routing hint must NEVER block a successful sign-in. If the membership
    // probe fails, send the user to /dashboard and let requireOrg re-resolve the
    // real destination (it redirects to /onboarding when there is no membership).
    console.error('resolvePostLoginPath failed:', loggableFailure(err));
    return '/dashboard';
  }
}

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

// --- Email OTP -------------------------------------------------------------
export async function sendEmailOtp(email: string): Promise<ActionResult> {
  const refused = identifierRefusal('email', email);
  if (refused) return refused;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  return error ? otpSendFailure('sendEmailOtp failed', error, 'email') : ok();
}

export async function verifyEmailOtp(email: string, token: string): Promise<ActionResult> {
  const refused = codeRefusal(token);
  if (refused) return refused;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  return error ? otpVerifyFailure('verifyEmailOtp failed', error) : ok();
}

// --- Phone OTP (site engineers) ---------------------------------------------
export async function sendPhoneOtp(phone: string): Promise<ActionResult> {
  const refused = identifierRefusal('phone', phone);
  if (refused) return refused;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });
  return error ? otpSendFailure('sendPhoneOtp failed', error, 'phone') : ok();
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<ActionResult> {
  const refused = codeRefusal(token);
  if (refused) return refused;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  return error ? otpVerifyFailure('verifyPhoneOtp failed', error) : ok();
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// Org onboarding moved to lib/org/actions.ts (createOrg + logo upload).
