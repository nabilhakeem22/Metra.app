import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { runtimeSecret } from '@/lib/cf/secrets';
import { STORAGE_TIMEOUT_MS } from '@/lib/http/deadlines';
import { supabaseUrl } from './config';

/**
 * Every Storage request this client makes, with a deadline on it.
 *
 * The SDK offers no timeout option, so the bound goes on the `fetch` it is built
 * with. Without it a stalled Storage origin held a server action open until the
 * platform killed the request — the DB path has had `CF_DB_DEADLINE_MS` since
 * wave 2 and this one had nothing. `AbortSignal.timeout` is supported on
 * Cloudflare Workers and Node 18+, and actually aborts the request rather than
 * only abandoning the wait.
 *
 * A caller-supplied signal is honoured alongside ours, never replaced: whichever
 * fires first wins, so an SDK that cancels its own upload keeps that power.
 */
function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit) {
  const deadline = AbortSignal.timeout(STORAGE_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  return fetch(input, { ...init, signal });
}

/**
 * Service-role client. FULL bypass — server-only, never expose to the browser.
 * Used to mint storage signed URLs AFTER an org-ownership check via RLS.
 */
export function createSupabaseAdminClient() {
  // Read at REQUEST time, never inlined into the Worker bundle: this key is a
  // full RLS bypass and has no business sitting in a build artifact.
  const key = runtimeSecret('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithDeadline },
  });
}
