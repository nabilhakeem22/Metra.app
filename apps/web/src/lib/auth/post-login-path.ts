import 'server-only';
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { withUserContext } from '@/lib/db/context';
import type { MemberRole } from '@/lib/permissions/roles';
import { SITE_APP_LIVE } from '@/lib/site/app-live';
import type { LoginReturn, PostLoginPath } from './otp-contract';
import { postLoginPathOf } from './post-login-rule';

/**
 * Where to send a user right after login (the rule is ./post-login-rule.ts).
 * Memberships are read server-side via the SECURITY DEFINER fn, scoped to the
 * caller. This routing hint must NEVER block a successful sign-in: when there
 * is no user id or the probe fails, the rule lands on /dashboard, and
 * requireOrg re-resolves the real destination there.
 */
export async function postLoginPathFor(userId: string | undefined, returnTo?: LoginReturn): Promise<PostLoginPath> {
  const landing = { returnTo, siteAppLive: SITE_APP_LIVE };
  if (!userId) {
    console.error('verifyOtp returned no user');
    return postLoginPathOf(null, landing);
  }
  try {
    const memberships = (await withUserContext(userId, (tx) =>
      tx.execute(sql`select role from public.app_current_user_orgs()`),
    )) as unknown as Array<{ role: MemberRole }>;
    return postLoginPathOf(
      memberships.map((membership) => membership.role),
      landing,
    );
  } catch (err) {
    console.error('resolvePostLoginPath failed:', loggableFailure(err));
    return postLoginPathOf(null, landing);
  }
}
