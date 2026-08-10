'use server';

import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { withUserContext } from '@/lib/db/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSessionUser } from './session';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Where to send a user right after login: their dashboard if they belong to at
 * least one org, otherwise onboarding. Membership resolved server-side via the
 * SECURITY DEFINER fn (scoped to the caller).
 */
export async function resolvePostLoginPath(): Promise<string> {
  const user = await getSessionUser();
  if (!user) return '/login';
  const orgs = (await withUserContext(user.id, (tx) =>
    tx.execute(sql`select 1 from public.app_current_user_orgs() limit 1`),
  )) as unknown as unknown[];
  return orgs.length > 0 ? '/dashboard' : '/onboarding';
}

// Generic client-facing messages. Internal/Supabase error detail is logged
// server-side, never returned to the browser.
const SEND_ERROR = 'Could not send the code. Please try again.';
const VERIFY_ERROR = 'That code did not work. Please try again.';

// --- Email OTP -------------------------------------------------------------
export async function sendEmailOtp(email: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    console.error('sendEmailOtp failed:', error.message);
    return { ok: false, error: SEND_ERROR };
  }
  return { ok: true };
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
    return { ok: false, error: VERIFY_ERROR };
  }
  return { ok: true };
}

// --- Phone OTP (site engineers) — path in place ----------------------------
export async function sendPhoneOtp(phone: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) {
    console.error('sendPhoneOtp failed:', error.message);
    return { ok: false, error: SEND_ERROR };
  }
  return { ok: true };
}

export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) {
    console.error('verifyPhoneOtp failed:', error.message);
    return { ok: false, error: VERIFY_ERROR };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// Org onboarding moved to lib/org/actions.ts (createOrg + logo upload).
