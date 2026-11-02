'use server';

import { invitations, type MemberRole } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { failFields, fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { requireOrg } from '@/lib/auth/require-org';
import type { OrgContext } from '@/lib/db/context';
import { claimDailyEmail } from '@/lib/email/daily-caps';
import { sendInviteEmail } from '@/lib/email/resend';
import { canManageOrg } from '@/lib/permissions/can';
import { normalizeEmail } from '@/lib/validation/email';
import { getOrgMemberIdentities } from '../identities';
import { inviteFieldErrors } from '../invite-field-rules';
import { isInvitableRole } from '../invitable';
import { INVITE_TTL_DAYS, buildAcceptUrl, currentLocale, mintShareToken, orgDisplayName } from './helpers';

/** The partial unique index (org_id, email) where pending: the race arbiter. */
const PENDING_INVITE_INDEX = 'invitations_org_email_pending_idx';

/** The refusal for this caller and input, or null to go ahead. */
async function inviteRefusal(ctx: OrgContext, input: { email: string; role: MemberRole }): Promise<ActionResult | null> {
  if (!canManageOrg(ctx.role)) return err('forbidden');
  const errors = inviteFieldErrors(input);
  if (hasFieldErrors(errors)) return fieldsFailed(errors);
  // 'owner' is never invitable; 'client' has no internal use (the client portal).
  if (!isInvitableRole(input.role)) return err('malformed');
  const email = normalizeEmail(input.email);
  const members = await getOrgMemberIdentities(ctx);
  if (members.some((member) => (member.email ?? '').toLowerCase() === email)) {
    return fieldsFailed({ email: { code: 'already_member' } });
  }
  return null;
}

/** Writes the pending invite and its audit row; `data` says whether its email is within the daily cap. */
function recordInvitation(ctx: OrgContext, invite: { email: string; role: MemberRole; tokenHash: string }) {
  return mutateInOrg(
    ctx,
    { refusals: [{ constraint: PENDING_INVITE_INDEX, field: 'email', error: { code: 'pending_exists' } }] },
    async (tx, audit): Promise<boolean> => {
      // The common case, said before the insert; the index above is the race arbiter.
      const [pending] = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(and(eq(invitations.email, invite.email), eq(invitations.status, 'pending')))
        .limit(1);
      if (pending) failFields({ email: { code: 'pending_exists' } });
      // Before the audit row it counts, in the same transaction (lib/email/daily-caps.ts).
      const emailAllowed = await claimDailyEmail(tx, ctx.orgId, 'team_invite');
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
      const [invitation] = await tx
        .insert(invitations)
        .values({ orgId: ctx.orgId, ...invite, status: 'pending', invitedBy: ctx.userId, expiresAt })
        .returning({ id: invitations.id });
      await audit({ entity: 'invitation', entityId: invitation.id, action: 'create', before: null, after: { email: invite.email, role: invite.role } });
      return emailAllowed;
    },
  );
}

/**
 * Invite someone by email. Every refusal the studio can fix is said under the
 * Email box (empty, malformed, already a member, already invited); a role no
 * select offers is `malformed`. Answers the accept link, also when the email
 * could not be sent or the studio's daily invite email cap is reached (the Team
 * page shows it to copy). `busy` when the cap's lock could not be taken: no
 * invitation, no email.
 */
export async function inviteMember(input: { email: string; role: MemberRole }): Promise<ActionResult> {
  const ctx = await requireOrg();
  const refused = await inviteRefusal(ctx, input);
  if (refused) return refused;
  const email = normalizeEmail(input.email);

  // Resolve the absolute link BEFORE creating the invite: an unresolvable
  // origin must not persist an invitation whose link nobody ever receives.
  const { raw, hash } = mintShareToken();
  const locale = await currentLocale();
  const link = await buildAcceptUrl(locale, raw);
  if (!link) return unexpectedFailure('inviteMember: no request origin');

  const result = await recordInvitation(ctx, { email, role: input.role, tokenHash: hash });
  if (!result.ok) return result;
  if (result.data) await sendInviteEmail({ to: email, orgName: await orgDisplayName(ctx), acceptUrl: link, role: input.role, locale });
  return { ok: true, link };
}
