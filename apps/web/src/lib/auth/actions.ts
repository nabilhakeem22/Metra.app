'use server';

import { randomUUID } from 'node:crypto';
import { memberships, organizations } from '@merta/db';
import { redirect } from 'next/navigation';
import { recordAudit } from '@/lib/audit';
import { withOrgContext } from '@/lib/db/context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSessionUser } from './session';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// --- Email OTP -------------------------------------------------------------
export async function sendEmailOtp(email: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
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
  return error ? { ok: false, error: error.message } : { ok: true };
}

// --- Phone OTP (site engineers) — path in place ----------------------------
export async function sendPhoneOtp(phone: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  return error ? { ok: false, error: error.message } : { ok: true };
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
