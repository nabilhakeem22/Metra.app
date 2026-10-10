import 'server-only';
// Who a member is, as a security message names them (Round C, C8 fix round S1):
// the VERIFIED email of their auth account, which they cannot set without
// proving they own it, and their display name, cleaned (./display-name.ts).
// Read from Supabase auth by user id, so a stored notification carries only the
// id and the name is resolved when it is shown.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { withDeadline } from '@/lib/http/deadlines';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { safeDisplayName, type ActorIdentity } from './display-name';

/** A feed render waits at most this long for one identity; it then shows none. */
const IDENTITY_LOOKUP_TIMEOUT_MS = 2_000;

/** One answer per user id per isolate for this long, so the bell's poll does not ask every minute. */
const IDENTITY_CACHE_MS = 5 * 60 * 1000;

const cache = new Map<string, { identity: ActorIdentity; at: number }>();

/** The display name a user gave themselves, from the two keys profiles use. */
function metadataName(metadata: unknown): unknown {
  const fields = (metadata ?? {}) as { full_name?: unknown; display_name?: unknown };
  return typeof fields.full_name === 'string' && fields.full_name.trim() !== '' ? fields.full_name : fields.display_name;
}

/** A user as an alert names them, from an auth user object (the session's, or the admin API's). */
export function actorIdentityOf(user: { email?: string | null; user_metadata?: unknown } | null): ActorIdentity {
  return { name: safeDisplayName(metadataName(user?.user_metadata)), email: user?.email ?? null };
}

/** Never throws: a failed or slow lookup is an identity with neither part (not cached). */
export async function lookupActorIdentity(userId: string, now = Date.now()): Promise<ActorIdentity> {
  const cached = cache.get(userId);
  if (cached && now - cached.at < IDENTITY_CACHE_MS) return cached.identity;
  try {
    const { data, error } = await withDeadline(
      createSupabaseAdminClient().auth.admin.getUserById(userId),
      IDENTITY_LOOKUP_TIMEOUT_MS,
      'actor identity lookup',
    );
    if (error) throw error;
    const identity = actorIdentityOf(data.user);
    cache.set(userId, { identity, at: now });
    return identity;
  } catch (err) {
    console.error('actor identity lookup failed:', loggableFailure(err));
    return { name: null, email: null };
  }
}
