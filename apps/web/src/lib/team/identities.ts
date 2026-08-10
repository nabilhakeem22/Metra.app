import 'server-only';
import { memberships, type MemberRole } from '@metra/db';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface MemberIdentity {
  membershipId: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  createdAt: string;
}

/**
 * Members of the caller's org with resolved identity. The membership list is read
 * under RLS (org-scoped), so admin.getUserById is only ever called for user ids
 * that already belong to this org — no cross-org / global user enumeration.
 */
export async function getOrgMemberIdentities(
  ctx: OrgContext,
): Promise<MemberIdentity[]> {
  const rows = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships),
  );

  const admin = createSupabaseAdminClient();
  const identities: MemberIdentity[] = [];

  for (const row of rows) {
    let email: string | null = null;
    let fullName: string | null = null;
    try {
      const { data } = await admin.auth.admin.getUserById(row.userId);
      email = data.user?.email ?? null;
      const meta = data.user?.user_metadata as
        | { full_name?: string; display_name?: string }
        | undefined;
      fullName = meta?.full_name ?? meta?.display_name ?? null;
    } catch {
      // Leave identity fields null if the auth lookup fails.
    }
    identities.push({
      membershipId: row.id,
      userId: row.userId,
      email,
      fullName,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    });
  }

  return identities;
}
