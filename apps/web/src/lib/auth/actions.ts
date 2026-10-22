'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Sign-in itself is not a server action: the login page is a static asset, and
// a POST to an asset path is a 405, so the form calls the JSON routes under
// app/api/auth/otp (lib/auth/otp-contract.ts).

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// Org onboarding moved to lib/org/actions.ts (createOrg + logo upload).
