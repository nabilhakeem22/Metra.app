// PURE cores for the team mutations — no next/*, no getSessionUser, no cookies,
// no server-only. Take an OrgContext + validated input; the 'use server'
// wrappers in ./actions do requireOrg()/cookie/token work and delegate here.
// These are exercised directly (no Next layer) by tests/actions/*.dbtest.ts.
import { invitations, MEMBER_ROLES, memberships, type MemberRole } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import {
  ensureNotLastOwner,
  lockOrgMemberships,
} from '@/lib/aggregates/membership';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, ok, type ActionResult } from '@/lib/actions/result';
import { recordAudit } from '@/lib/audit';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

function isMemberRole(role: string): role is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(role);
}

export async function changeMemberRoleCore(
  ctx: OrgContext,
  input: { userId: string; role: MemberRole },
): Promise<ActionResult> {
  if (!isMemberRole(input.role)) return err('invalid');
  if (input.userId === ctx.userId) return err('self');
  const role = input.role;

  return mutateInOrg(
    ctx,
    { capability: 'users_settings', action: 'update' },
    async (tx, audit) => {
      await lockOrgMemberships(tx, ctx.orgId);
      const [target] = await tx
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, input.userId))
        .limit(1);
      if (!target) fail('invalid');

      if ((target.role === 'owner' || role === 'owner') && ctx.role !== 'owner') {
        fail('owner_immutable');
      }
      if (target.role === 'owner' && role !== 'owner') {
        await ensureNotLastOwner(tx);
      }
      if (target.role === role) return;

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
    },
  );
}

export async function removeMemberCore(
  ctx: OrgContext,
  userId: string,
): Promise<ActionResult> {
  if (userId === ctx.userId) return err('self');

  return mutateInOrg(
    ctx,
    { capability: 'users_settings', action: 'update' },
    async (tx, audit) => {
      await lockOrgMemberships(tx, ctx.orgId);
      const [target] = await tx
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, userId))
        .limit(1);
      if (!target) fail('invalid');

      if (target.role === 'owner' && ctx.role !== 'owner') {
        fail('owner_immutable');
      }
      if (target.role === 'owner') {
        await ensureNotLastOwner(tx);
      }

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

/**
 * The withOrgContext half of acceptInvite: atomically claim the invite (via the
 * SECURITY DEFINER app_claim_invitation), insert the caller's own membership,
 * audit, and F4-recheck for an already-member re-opener. Every failure -> the
 * SAME generic 'declined' (no oracle). `ctx` MUST carry the invite's org, the
 * caller's userId + email, and the invited role.
 */
export async function acceptInviteCore(
  ctx: OrgContext,
  invitationId: string,
): Promise<ActionResult> {
  const outcome = await withOrgContext(
    ctx,
    async (tx): Promise<'joined' | 'already' | 'declined'> => {
      const claimed = (await tx.execute(
        sql`select id from public.app_claim_invitation(${invitationId})`,
      )) as unknown as unknown[];

      if (claimed.length === 1) {
        const inserted = await tx
          .insert(memberships)
          .values({ orgId: ctx.orgId, userId: ctx.userId, role: ctx.role })
          .onConflictDoNothing()
          .returning({ id: memberships.id });
        if (inserted[0]) {
          await recordAudit(tx, {
            entity: 'membership',
            entityId: inserted[0].id,
            action: 'create',
            before: null,
            after: {
              user_id: ctx.userId,
              role: ctx.role,
              via: 'invitation',
              invitation_id: invitationId,
            },
          });
        }
        return 'joined';
      }

      const [current] = await tx
        .select({ status: invitations.status })
        .from(invitations)
        .where(eq(invitations.id, invitationId))
        .limit(1);
      const [mine] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, ctx.userId))
        .limit(1);

      if (current?.status === 'accepted' && mine) return 'already';
      return 'declined';
    },
  );

  if (outcome === 'declined') return err('declined');
  return outcome === 'already' ? ok({ already: true }) : ok();
}
