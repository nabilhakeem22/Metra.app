import 'server-only';
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { withUserContext } from '@/lib/db/context';
import type { PostLoginPath } from './otp-contract';

/**
 * Where to send a user right after login: their dashboard if they belong to at
 * least one org, otherwise onboarding. Membership resolved server-side via the
 * SECURITY DEFINER fn (scoped to the caller).
 */
export async function postLoginPathFor(userId: string): Promise<PostLoginPath> {
  try {
    const orgs = (await withUserContext(userId, (tx) =>
      tx.execute(sql`select 1 from public.app_current_user_orgs() limit 1`),
    )) as unknown as unknown[];
    return orgs.length > 0 ? '/dashboard' : '/onboarding';
  } catch (err) {
    // This routing hint must NEVER block a successful sign-in. If the membership
    // probe fails, send the user to /dashboard and let requireOrg re-resolve the
    // real destination (it redirects to /onboarding when there is no membership).
    console.error('resolvePostLoginPath failed:', loggableFailure(err));
    return '/dashboard';
  }
}
