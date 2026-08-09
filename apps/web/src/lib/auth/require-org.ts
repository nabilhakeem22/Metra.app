import 'server-only';
import type { MemberRole } from '@metra/db';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { withUserContext, type OrgContext } from '@/lib/db/context';
import { getSessionUser } from './session';

/**
 * Resolves the caller's org context. Redirects to /login if unauthenticated, or
 * /onboarding if the user has no membership yet. Returns {orgId, userId, role}.
 *
 * The user->org lookup uses the SECURITY DEFINER function
 * app_current_user_memberships(), which is scoped to app.current_user_id and
 * never relies on a permissive RLS policy — so it cannot see another user's
 * rows or leak another org's membership rows.
 */
export async function requireOrg(): Promise<OrgContext> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  const rows = (await withUserContext(user.id, (tx) =>
    tx.execute(
      sql`select org_id as "orgId", role from public.app_current_user_memberships() limit 1`,
    ),
  )) as unknown as Array<{ orgId: string; role: MemberRole }>;

  if (rows.length === 0) {
    redirect('/onboarding');
  }

  return { orgId: rows[0].orgId, userId: user.id, role: rows[0].role };
}
