import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** The authenticated Supabase user, or null. Verified against the auth server. */
export async function getSessionUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
