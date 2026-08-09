'use server';

import { randomUUID } from 'node:crypto';
import { memberships, organizations } from '@merta/db';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { recordAudit } from '@/lib/audit';
import { withOrgContext, withUserContext } from '@/lib/db/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSessionUser } from './session';

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

// --- Org onboarding (atomic: org + owner membership + audit) ---------------
// Form action: returns void. Success ends in a redirect() (which throws
// NEXT_REDIRECT and never returns); invalid input throws.
export async function createOrg(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  // Prevent org spam: if this user is already a member of an org, don't create
  // another — send them to their dashboard. Checked via the SECURITY DEFINER
  // bootstrap (scoped to app.current_user_id), the same path requireOrg uses.
  const existing = (await withUserContext(user.id, (tx) =>
    tx.execute(
      sql`select 1 from public.app_current_user_memberships() limit 1`,
    ),
  )) as unknown as unknown[];
  if (existing.length > 0) {
    redirect('/dashboard');
  }

  const nameEn = String(formData.get('nameEn') ?? '').trim() || null;
  const nameAr = String(formData.get('nameAr') ?? '').trim() || null;
  if (!nameEn && !nameAr) {
    throw new Error('At least one firm name is required.');
  }

  const orgId = randomUUID();

  await withOrgContext(
    { orgId, userId: user.id, role: 'owner' },
    async (tx) => {
      await tx
        .insert(organizations)
        .values({ id: orgId, nameEn, nameAr, defaultLocale: 'ar-EG' });

      await tx
        .insert(memberships)
        .values({ orgId, userId: user.id, role: 'owner' });

      await recordAudit(tx, {
        entity: 'organization',
        entityId: orgId,
        action: 'create',
        before: null,
        after: { name_en: nameEn, name_ar: nameAr },
      });
    },
  );

  redirect('/dashboard');
}
