'use server';

import { invitations, type MemberRole } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { invariant } from '@/lib/actions/invariant';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { requireOrg } from '@/lib/auth/require-org';
import { claimDailyEmail } from '@/lib/email/daily-caps';
import { sendInviteEmail } from '@/lib/email/resend';
import { canManageOrg } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';
import { INVITE_TTL_DAYS, buildAcceptUrl, currentLocale, mintShareToken, orgDisplayName } from './helpers';

/**
 * Mint a fresh link for a pending invite and email it again (also the "copy
 * link" path). An invite accepted or revoked meanwhile is `record_not_found`.
 * Past the studio's daily invite email cap the link is still rotated and
 * returned, and no email goes out.
 */
export async function resendInvite(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
  if (!isUuid(id)) return err('malformed');

  const { raw, hash } = mintShareToken();
  const locale = await currentLocale();
  const link = await buildAcceptUrl(locale, raw);
  if (!link) return unexpectedFailure('resendInvite: no request origin');

  const result = await mutateInOrg(ctx, {}, async (tx, audit): Promise<{ email: string; role: MemberRole; emailAllowed: boolean }> => {
    const [invitation] = await tx
      .select({ email: invitations.email, role: invitations.role, status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1);
    if (!invitation || invitation.status !== 'pending') fail('record_not_found');
    // Before the audit row it counts, in the same transaction (lib/email/daily-caps.ts).
    const emailAllowed = await claimDailyEmail(tx, ctx.orgId, 'team_invite');
    await tx
      .update(invitations)
      .set({ tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000), updatedAt: new Date() })
      .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')));
    await audit({ entity: 'invitation', entityId: id, action: 'update', before: null, after: { resent: true } });
    return { email: invitation.email, role: invitation.role, emailAllowed };
  });
  if (!result.ok) return result;
  invariant(result.data, 'resendInvite: the mutation answered no invitation');

  const { email, role, emailAllowed } = result.data;
  if (emailAllowed) await sendInviteEmail({ to: email, orgName: await orgDisplayName(ctx), acceptUrl: link, role, locale });
  return { ok: true, link };
}
