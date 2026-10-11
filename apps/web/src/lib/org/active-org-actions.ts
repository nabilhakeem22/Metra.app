'use server';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { ActionResult } from '@/lib/actions/result';
import { ACTIVE_ORG_COOKIE, activeOrgCookieOptions } from '@/lib/auth/active-org';
import { getSessionUser } from '@/lib/auth/session';
import { withUserContext } from '@/lib/db/context';

/**
 * Switches the signed-in user's active org (the org switcher). Never trusts the
 * client-supplied id: membership is checked server-side through the SECURITY
 * DEFINER `app_current_user_orgs()`, and a non-member gets `forbidden` with no
 * cookie set.
 */
export async function setActiveOrg(orgId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'forbidden' };

  const rows = (await withUserContext(user.id, (tx) =>
    tx.execute(
      sql`select org_id from public.app_current_user_orgs() where org_id = ${orgId} limit 1`,
    ),
  )) as unknown as unknown[];
  if (rows.length === 0) return { ok: false, error: 'forbidden' };

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, activeOrgCookieOptions());
  revalidatePath('/', 'layout');
  return { ok: true };
}
