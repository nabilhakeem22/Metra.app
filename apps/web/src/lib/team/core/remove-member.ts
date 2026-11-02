// A PURE team core: no next/*, no server-only (see ./index.ts).
import { memberships } from '@metra/db';
import { eq } from 'drizzle-orm';
import { ensureNotLastOwner } from '@/lib/aggregates/membership';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { closeSiteAccessOf } from '@/lib/site/close-site-access';
import { lockedMembershipTarget } from './membership-target';

/**
 * Remove a member from the studio. In the same transaction his live site
 * assignments and signed-in phones here are revoked (lib/site/close-site-access.ts),
 * so nothing on the site side outlives the membership.
 */
export async function removeMemberCore(
  ctx: OrgContext,
  userId: string,
): Promise<ActionResult> {
  if (userId === ctx.userId) return err('self');

  return mutateInOrg(
    ctx,
    { capability: 'users_settings', action: 'update' },
    async (tx, audit) => {
      const target = await lockedMembershipTarget(tx, ctx.orgId, userId);
      if (target.role === 'owner' && ctx.role !== 'owner') {
        fail('owner_immutable');
      }
      if (target.role === 'owner') {
        await ensureNotLastOwner(tx);
      }

      await closeSiteAccessOf(tx, audit, { memberId: userId, closedBy: ctx.userId, via: 'member_removed' });
      await tx.delete(memberships).where(eq(memberships.id, target.id));
      await audit({
        entity: 'membership',
        entityId: target.id,
        action: 'delete',
        before: { user_id: userId, role: target.role },
        after: null,
      });
    },
  );
}
