import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl } from './config';

/**
 * Service-role client. FULL bypass — server-only, never expose to the browser.
 * Used to mint storage signed URLs AFTER an org-ownership check via RLS.
 */
export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
