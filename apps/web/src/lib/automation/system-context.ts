import 'server-only';
import { memberships } from '@metra/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import type { OrgContext } from '@/lib/db/context';

/**
 * The system actor for a session-less automation run: the org's earliest-created
 * `owner` membership (fallback: earliest `admin`). Read on the PRIVILEGED runtime
 * connection (no session, no withOrgContext) — only the system table
 * `memberships`. Returns an OrgContext with the actor's ACTUAL role (owner or
 * admin) so the capability matrix — not a hardcoded role — decides what the run
 * may do (least privilege); null if the org has no owner/admin (runner skips it).
 * All subsequent business reads/writes happen inside a single-org withOrgContext
 * RLS tx keyed on this actor.
 */
export async function resolveSystemContext(
  orgId: string,
): Promise<OrgContext | null> {
  const rows = await withRequestDb((db) =>
    db
      .select({
        userId: memberships.userId,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, orgId),
          inArray(memberships.role, ['owner', 'admin']),
        ),
      )
      .orderBy(asc(memberships.createdAt)),
  );

  const actor =
    rows.find((r) => r.role === 'owner') ?? rows.find((r) => r.role === 'admin');
  if (!actor) return null;
  return { orgId, userId: actor.userId, role: actor.role };
}
