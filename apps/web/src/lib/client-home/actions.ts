'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { requireOrg } from '@/lib/auth/require-org';
import { deliveryPortalUrl, requestLocaleOrDefault } from '@/lib/engagements/portal-url';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import { ensureClientHomeCore } from './ensure';
import type { ClientHomeLinkReason } from './types';

/**
 * Server-action wrapper for {@link ensureClientHomeCore}: the contract's
 * client home, and its Execution tab's absolute URL (`link`,
 * `/d/<token>?tab=execution` in the studio user's locale) when the caller may
 * see it, else `linkReason`. Revalidates the shell on success (a light
 * delivery may have been created). Never throws to the client.
 */
export async function openClientHome(
  contractId: string,
): Promise<ActionResult & { link?: string; linkReason?: ClientHomeLinkReason }> {
  const ctx = await requireOrg();
  // Resolve the link origin BEFORE the write: an origin we cannot resolve must
  // not leave behind a created home whose link the caller never receives.
  const origin = await resolveRequestOrigin();
  if (!origin) return unexpectedFailure('openClientHome: no request origin');
  const res = await ensureClientHomeCore(ctx, { contractId });
  if (!res.ok) return res;
  if (!res.data) return unexpectedFailure('ensureClientHomeCore answered ok without a home');
  refreshApp();
  const { link, linkReason } = res.data;
  if (link === null) return { ok: true, linkReason };
  return { ok: true, link: `${deliveryPortalUrl(origin, await requestLocaleOrDefault(), link)}?tab=execution` };
}
