'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ActionResult {
  ok: boolean;
  error?: string;
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
