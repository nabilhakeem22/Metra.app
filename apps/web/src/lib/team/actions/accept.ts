'use server';

import { createHash } from 'node:crypto';
import { type MemberRole } from '@metra/db';
import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import {
  ACTIVE_ORG_COOKIE,
  activeOrgCookieOptions,
} from '@/lib/auth/active-org';
import { getSessionUser } from '@/lib/auth/session';
import { withUserContext } from '@/lib/db/context';
import { acceptInviteCore } from '../core';
import { type ActionResult } from '@/lib/actions/result';

// --- Accept invite ---------------------------------------------------------
// Wrapper does session + token lookup + expiry/email validation, then delegates
// the claim/membership/F4 to acceptInviteCore. Every failure -> generic
// 'declined' (no oracle for wrong-email vs expired etc.). On success, sets the
// active-org cookie.
export async function acceptInvite(rawToken: string): Promise<ActionResult> {
  const DECLINED: ActionResult = { ok: false, error: 'declined' };

  const user = await getSessionUser();
  if (!user?.email) return DECLINED;

  const tokenHash = createHash('sha256')
    .update(String(rawToken ?? ''))
    .digest('hex');

  try {
    const rows = (await withUserContext(user.id, (tx) =>
      tx.execute(
        sql`select id, org_id, email, role, status, expires_at
            from public.app_invitation_by_token(${tokenHash})`,
      ),
    )) as unknown as Array<{
      id: string;
      org_id: string;
      email: string;
      role: MemberRole;
      status: string;
      expires_at: string;
    }>;

    const inv = rows[0];
    if (!inv) return DECLINED;
    if (new Date(inv.expires_at).getTime() <= Date.now()) return DECLINED;
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) return DECLINED;

    const res = await acceptInviteCore(
      { orgId: inv.org_id, userId: user.id, role: inv.role, email: user.email },
      inv.id,
    );
    if (!res.ok) return DECLINED;

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, inv.org_id, activeOrgCookieOptions());
    return res;
  } catch (e) {
    console.error('acceptInvite failed:', e);
    return DECLINED;
  }
}
