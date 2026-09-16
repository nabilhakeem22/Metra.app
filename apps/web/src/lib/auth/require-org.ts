import 'server-only';
import type { MemberRole } from '@metra/db';
import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { withUserContext, type OrgContext } from '@/lib/db/context';
import { ACTIVE_ORG_COOKIE } from './active-org';
import { getSessionUser } from './session';

/**
 * Resolves the caller's org context. Redirects to /login if unauthenticated, or
 * /onboarding if the user has no membership yet. Returns {orgId, userId, role}.
 *
 * Active-org selection: honors the `metra_active_org` cookie ONLY if it names an
 * org the user is really a member of (re-validated every request via the
 * SECURITY DEFINER fn, scoped to app.current_user_id). A hand-edited cookie
 * pointing at a non-member org is ignored → falls back to the first membership
 * and the stale cookie is cleared. The cookie is never trusted on its own.
 */
export async function requireOrg(): Promise<OrgContext> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  const orgs = (await withUserContext(user.id, (tx) =>
    tx.execute(
      sql`select org_id as "orgId", role, account_id as "accountId"
          from public.app_current_user_orgs()`,
    ),
  )) as unknown as Array<{
    orgId: string;
    role: MemberRole;
    accountId: string | null;
  }>;

  if (orgs.length === 0) {
    redirect('/onboarding');
  }

  // THE `client` ROLE IS NOT AN INTERNAL ROLE. It belongs to the P4 client
  // portal, which authenticates with a share token and never calls this. The app
  // shell already 404s it, but a layout is not a gate: server actions are
  // directly invokable without one ever rendering, and every internal action
  // starts here. `client` holds `projects: R`, so `getProjectDocumentUrl` would
  // mint a signed download URL for any project document in the org given the
  // file's id. Nothing can reach it today (`team/invitable.ts` makes the role
  // non-invitable, so the membership cannot be created through the product) —
  // this is the fence that keeps it unreachable the day P4 provisions one.
  const internalOrgs = orgs.filter((org) => org.role !== 'client');
  if (internalOrgs.length === 0) {
    notFound();
  }

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  const active =
    (requested && internalOrgs.find((o) => o.orgId === requested)) || internalOrgs[0];

  // Clear a stale/tampered cookie that doesn't match a real membership.
  if (requested && requested !== active.orgId) {
    try {
      cookieStore.delete(ACTIVE_ORG_COOKIE);
    } catch {
      // delete during render can throw; harmless — cookie is ignored anyway.
    }
  }

  return {
    orgId: active.orgId,
    userId: user.id,
    role: active.role,
    accountId: active.accountId ?? undefined,
  };
}
