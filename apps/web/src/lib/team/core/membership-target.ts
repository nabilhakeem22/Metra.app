// A PURE team core: no next/*, no server-only (see ./index.ts).
import { MEMBER_ROLES, memberships, type MemberRole, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { lockOrgMemberships } from '@/lib/aggregates/membership';
import { fail } from '@/lib/actions/mutate';

export function isMemberRole(role: string): role is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(role);
}

/**
 * The membership a role change or a removal acts on, read after the org's
 * memberships are locked. Refuses `record_not_found` when `userId` is not a
 * member here.
 */
export async function lockedMembershipTarget(
  tx: MetraDb,
  orgId: string,
  userId: string,
): Promise<{ id: string; role: MemberRole }> {
  await lockOrgMemberships(tx, orgId);
  const [target] = await tx
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (!target) fail('record_not_found');
  return target;
}
