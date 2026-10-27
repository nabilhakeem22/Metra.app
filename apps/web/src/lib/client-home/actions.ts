'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { requireOrg } from '@/lib/auth/require-org';
import { deliveryPortalUrl, requestLocaleOrDefault } from '@/lib/engagements/portal-url';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import { ensureClientHomeCore } from './ensure';
import { resetClientCodesCore, type CodesReset } from './reset-codes';
import type { ClientHomeLink } from './types';

/**
 * Server-action wrapper for {@link ensureClientHomeCore}: the contract's
 * client home, and its Execution tab's absolute URL (`link`,
 * `/d/<token>?tab=execution` in the studio user's locale) when it can be
 * shown, else `linkReason`. Revalidates the shell on success (a light
 * delivery may have been created). Never throws to the client.
 */
export async function openClientHome(
  contractId: string,
): Promise<(ActionResult & { ok: false }) | ({ ok: true } & ClientHomeLink)> {
  const ctx = await requireOrg();
  // Resolve the link origin BEFORE the write: an origin we cannot resolve must
  // not leave behind a created home whose link the caller never receives.
  const origin = await resolveRequestOrigin();
  if (!origin) return unexpectedFailure('openClientHome: no request origin');
  const res = await ensureClientHomeCore(ctx, { contractId });
  if (!res.ok) return { ...res, ok: false };
  if (!res.data) return unexpectedFailure('ensureClientHomeCore answered ok without a home');
  refreshApp();
  const home = res.data;
  if (home.link === null) return { ok: true, link: null, linkReason: home.linkReason };
  return { ok: true, link: `${deliveryPortalUrl(origin, await requestLocaleOrDefault(), home.link)}?tab=execution` };
}

/**
 * Server-action wrapper for {@link resetClientCodesCore}: the client's
 * one-time codes on this delivery start over (owner or admin), and how many
 * codes still in the client's mail it voided. Revalidates the shell on
 * success. Never throws to the client.
 */
export async function resetClientCodes(engagementId: string): Promise<ActionResult & { data?: CodesReset }> {
  const ctx = await requireOrg();
  const res = await resetClientCodesCore(ctx, engagementId);
  if (res.ok) refreshApp();
  return res;
}
