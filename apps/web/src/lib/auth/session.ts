import 'server-only';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The authenticated Supabase user, or null. Verified against the auth server,
 * once per render: `requireOrg`, the layout and the page all ask, and `cache`
 * makes that one round trip. Outside a render (actions, route handlers) it is a
 * plain call.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
