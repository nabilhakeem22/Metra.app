'use server';

import { revalidatePath } from 'next/cache';
import { fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { ok, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { accountFieldErrors } from './field-rules';

/** Per-user account prefs in Supabase user_metadata (display name, language). */
export async function updateAccount(input: {
  fullName?: string;
  locale?: 'ar-EG' | 'en';
}): Promise<ActionResult> {
  const errors = accountFieldErrors(input);
  if (hasFieldErrors(errors)) return fieldsFailed(errors);

  const data: Record<string, unknown> = {};
  if (input.fullName !== undefined) data.full_name = input.fullName.trim();
  if (input.locale) data.locale = input.locale;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ data });
  if (error) return unexpectedFailure('updateAccount failed', error);

  revalidatePath('/', 'layout');
  return ok();
}
