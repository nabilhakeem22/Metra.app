// A PURE team core: no next/*, no server-only (see ./index.ts).
import { memberships, type MemberRole, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { ensureNotLastOwner } from '@/lib/aggregates/membership';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import { closeSiteAccessOf } from '@/lib/site/close-site-access';
import { mayJoinSiteTeam } from '@/lib/site/access';
import { isMemberRole, lockedMembershipTarget } from './membership-target';

/** Writes the new role onto the membership and audits the change. */
async function writeRoleChange(
  tx: MetraDb,
  audit: (entry: AuditEntry) => Promise<void>,
  target: { id: string; role: MemberRole },
  role: MemberRole,
): Promise<void> {
  await tx
    .update(memberships)
    .set({ role, updatedAt: new Date() })
    .where(eq(memberships.id, target.id));
  await audit({
    entity: 'membership',
    entityId: target.id,
    action: 'update',
    before: { role: target.role },
    after: { role },
  });
}

/**
 * Change a member's role. A role that may not be on a site team (today: client)
 * closes his live site assignments and phones here in the same transaction
 * (lib/site/close-site-access.ts); giving the old role back revives none of
 * them, he is assigned again from the project's Team tab.
 */
export async function changeMemberRoleCore(
  ctx: OrgContext,
  input: { userId: string; role: MemberRole },
): Promise<ActionResult> {
  if (!isMemberRole(input.role)) return err('malformed');
  if (input.userId === ctx.userId) return err('self');
  const role = input.role;

  return mutateInOrg(
    ctx,
    { capability: 'users_settings', action: 'update' },
    async (tx, audit) => {
      const target = await lockedMembershipTarget(tx, ctx.orgId, input.userId);
      if ((target.role === 'owner' || role === 'owner') && ctx.role !== 'owner') {
        fail('owner_immutable');
      }
      if (target.role === 'owner' && role !== 'owner') {
        await ensureNotLastOwner(tx);
      }
      if (target.role === role) return;

      await writeRoleChange(tx, audit, target, role);
      if (!mayJoinSiteTeam(role)) {
        await closeSiteAccessOf(tx, audit, { memberId: input.userId, closedBy: ctx.userId, via: 'role_changed' });
      }
    },
  );
}
