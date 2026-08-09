import 'server-only';
import { memberships } from '@merta/db';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { withUserContext, type OrgContext } from '@/lib/db/context';
import { getSessionUser } from './session';

/**
 * Resolves the caller's org context. Redirects to /login if unauthenticated, or
 * /onboarding if the user has no membership yet. Returns {orgId, userId, role}.
 */
export async function requireOrg(): Promise<OrgContext> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  const rows = await withUserContext(user.id, (tx) =>
    tx
      .select({ orgId: memberships.orgId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1),
  );

  if (rows.length === 0) {
    redirect('/onboarding');
  }

  return { orgId: rows[0].orgId, userId: user.id, role: rows[0].role };
}
