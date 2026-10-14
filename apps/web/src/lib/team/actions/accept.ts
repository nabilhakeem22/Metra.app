'use server';

import { createHash } from 'node:crypto';
import { type MemberRole } from '@metra/db';
import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { ACTIVE_ORG_COOKIE, activeOrgCookieOptions } from '@/lib/auth/active-org';
import { getSessionUser } from '@/lib/auth/session';
import { withUserContext } from '@/lib/db/context';
import { acceptInviteCore } from '../core';

interface InvitationRow {
  id: string;
  org_id: string;
  email: string;
  role: MemberRole;
  status: string;
  expires_at: string;
}

// --- Accept invite ---------------------------------------------------------
// Session + token lookup, then the cause a person can act on (D9): the link
// expired (ask for a new one), it was sent to another account (sign in with
// that one), or it is not valid any more (used, revoked, unknown). The invited
// address is never sent back. The claim/membership/F4 recheck is the core's.
// On success, sets the active-org cookie.
export async function acceptInvite(rawToken: string): Promise<ActionResult> {
  const user = await getSessionUser();
  // A phone-only session can never be the invited email address.
  if (!user?.email) return err('invite_wrong_account');

  const tokenHash = createHash('sha256').update(String(rawToken ?? '')).digest('hex');

  try {
    const rows = (await withUserContext(user.id, (tx) =>
      tx.execute(
        sql`select id, org_id, email, role, status, expires_at
            from public.app_invitation_by_token(${tokenHash})`,
      ),
    )) as unknown as InvitationRow[];

    const invitation = rows[0];
    if (!invitation) return err('invite_not_found');
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) return err('invite_wrong_account');
    // Only the invitee learns the link has expired (S2): the account match comes first.
    if (new Date(invitation.expires_at).getTime() <= Date.now()) return err('invite_expired');

    const result = await acceptInviteCore(
      { orgId: invitation.org_id, userId: user.id, role: invitation.role, email: user.email },
      invitation.id,
    );
    if (!result.ok) return result;

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, invitation.org_id, activeOrgCookieOptions());
    return result;
  } catch (e) {
    return unexpectedFailure('acceptInvite failed', e);
  }
}
