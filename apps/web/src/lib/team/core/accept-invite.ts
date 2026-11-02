// A PURE team core: no next/*, no server-only (see ./index.ts).
import { randomUUID } from 'node:crypto';
import { invitations, memberships, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { err, ok, type ActionResult } from '@/lib/actions/result';
import { recordAudit } from '@/lib/audit';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** Inserts the caller's own membership for the invitation this tx just claimed, and audits it. */
async function insertClaimedMembership(tx: MetraDb, ctx: OrgContext, invitationId: string): Promise<void> {
  // Raw single-statement insert — NOT the drizzle builder and NOT
  // onConflictDoNothing. The bootstrap accepted-invite WITH CHECK reads the
  // invitation THIS tx just claimed; both ON CONFLICT (speculative read) and
  // drizzle's `.returning()` builder issue a shape that loses that same-tx
  // visibility and the RLS check fails. A raw INSERT with a client-side id
  // (mirrors tests/isolation) evaluates the check against the live snapshot.
  // A claim==1 path can never collide: inviteMember refuses to invite an
  // existing member, so a user holding a freshly-pending invite is provably
  // not yet a member. Nothing may run between the claim and this insert.
  const membershipId = randomUUID();
  await tx.execute(
    sql`insert into public.memberships (id, org_id, user_id, role)
              values (${membershipId}, ${ctx.orgId}, ${ctx.userId}, ${ctx.role})`,
  );
  await recordAudit(tx, {
    entity: 'membership',
    entityId: membershipId,
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

/** Why an invitation could not be claimed: already accepted by this member, or not claimable at all. */
async function classifyUnclaimed(
  tx: MetraDb,
  ctx: OrgContext,
  invitationId: string,
): Promise<'already' | 'unclaimable'> {
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
  return 'unclaimable';
}

/**
 * The withOrgContext half of acceptInvite: atomically claim the invite (via the
 * SECURITY DEFINER app_claim_invitation), insert the caller's own membership,
 * audit, and F4-recheck for an already-member re-opener. An invitation that
 * cannot be claimed (used, revoked, or not this caller's) is `invite_not_found`:
 * the wrapper has already told expiry and a wrong account apart. `ctx` MUST
 * carry the invite's org, the caller's userId + email, and the invited role.
 */
export async function acceptInviteCore(
  ctx: OrgContext,
  invitationId: string,
): Promise<ActionResult> {
  const outcome = await withOrgContext(
    ctx,
    async (tx): Promise<'joined' | 'already' | 'unclaimable'> => {
      const claimed = (await tx.execute(
        sql`select id from public.app_claim_invitation(${invitationId})`,
      )) as unknown as unknown[];

      if (claimed.length === 1) {
        await insertClaimedMembership(tx, ctx, invitationId);
        return 'joined';
      }
      return classifyUnclaimed(tx, ctx, invitationId);
    },
  );

  if (outcome === 'unclaimable') return err('invite_not_found');
  return outcome === 'already' ? ok({ already: true }) : ok();
}
