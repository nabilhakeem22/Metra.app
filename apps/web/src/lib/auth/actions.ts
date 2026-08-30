'use server';

import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { err, ok, type ActionResult } from '@/lib/actions/result';
import { withUserContext } from '@/lib/db/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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
    console.error('resolvePostLoginPath failed:', err);
    return '/dashboard';
  }
}

// Coded results only — the client localizes via resolveActionError. Supabase
// error detail is logged server-side, never returned to the browser.

// --- Email OTP -------------------------------------------------------------
export async function sendEmailOtp(email: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    console.error('sendEmailOtp failed:', error.message);
    return err('otp_send_failed');
  }
  return ok();
}

export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error) {
    console.error('verifyEmailOtp failed:', error.message);
    return err('otp_verify_failed');
  }
  return ok();
}

// --- Phone OTP (site engineers) — path in place ----------------------------
export async function sendPhoneOtp(phone: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) {
    console.error('sendPhoneOtp failed:', error.message);
    return err('otp_send_failed');
  }
  return ok();
}

export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) {
    console.error('verifyPhoneOtp failed:', error.message);
    return err('otp_verify_failed');
  }
  return ok();
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// Org onboarding moved to lib/org/actions.ts (createOrg + logo upload).
