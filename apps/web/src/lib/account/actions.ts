'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/auth/actions';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Per-user account prefs in Supabase user_metadata (display name, language). */
export async function updateAccount(input: {
  fullName?: string;
  locale?: 'ar-EG' | 'en';
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();

  const data: Record<string, unknown> = {};
  if (input.fullName !== undefined) data.full_name = input.fullName.trim();
  if (input.locale) data.locale = input.locale;

  const { error } = await supabase.auth.updateUser({ data });
  if (error) {
    console.error('updateAccount failed:', error.message);
    return { ok: false, error: 'generic' };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
