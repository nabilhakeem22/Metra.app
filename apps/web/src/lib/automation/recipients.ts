import 'server-only';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { AUTH_LOOKUP_TIMEOUT_MS, withDeadline } from '@/lib/http/deadlines';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { RecipientEmailLookup, RecipientLookup } from './types';

const LOOKUP_LABEL = 'automation recipient lookup';

/**
 * A recipient lookup for ONE tick: each user id reaches the Supabase admin API
 * at most once, and every later call for that id (from any org or core in the
 * same tick) shares the first call's answer, success or failure. The cache
 * lives inside the returned function, so a new tick starts empty and nothing
 * survives across requests.
 *
 * Only ever called with a userId the runner already resolved from `memberships`
 * (an owner/admin/sender), NEVER a client. Automation email therefore cannot
 * reach a client address (HUMAN-IN-THE-LOOP).
 */
export function createRecipientEmailLookup(): RecipientEmailLookup {
  const lookups = new Map<string, Promise<RecipientLookup>>();
  return (userId) => {
    let lookup = lookups.get(userId);
    if (!lookup) {
      lookup = fetchRecipientEmail(userId);
      lookups.set(userId, lookup);
    }
    return lookup;
  };
}

/**
 * Emails live in Supabase auth, not in the DB. Never throws: an auth error, a
 * missing key and a deadline are all `failed`, logged by shape only (no user
 * id, no address). `getUserById` takes no AbortSignal, so the deadline bounds
 * the WAIT; the admin client's own fetch abort (`STORAGE_TIMEOUT_MS`) still
 * frees the socket, so an abandoned request cannot outlive that.
 */
async function fetchRecipientEmail(userId: string): Promise<RecipientLookup> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await withDeadline(
      admin.auth.admin.getUserById(userId),
      AUTH_LOOKUP_TIMEOUT_MS,
      LOOKUP_LABEL,
    );
    if (error) {
      console.error(`${LOOKUP_LABEL} refused:`, loggableFailure(error));
      return { status: 'failed' };
    }
    const email = data.user?.email;
    return email ? { status: 'found', email } : { status: 'no-address' };
  } catch (err) {
    console.error(`${LOOKUP_LABEL} failed:`, loggableFailure(err));
    return { status: 'failed' };
  }
}
