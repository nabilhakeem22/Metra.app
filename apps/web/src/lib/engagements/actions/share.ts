'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import { deliveryPortalUrl, requestLocaleOrDefault } from '../portal-url';
import {
  mintDeliveryLinkCore,
  revokeDeliveryLinkCore,
  rotateDeliveryLinkCore,
} from '../share';

/** The durable public portal URL for a RAW token, in the studio user's locale. */
async function deliveryLink(origin: string, rawToken: string): Promise<string> {
  return deliveryPortalUrl(origin, await requestLocaleOrDefault(), rawToken);
}

/**
 * Server-action wrapper for {@link mintDeliveryLinkCore}: mints the FIRST client
 * share link and returns its absolute URL (`link`). Later it is shown again by
 * revealDeliveryLink (./reminder.ts) while SHARE_LINK_SECRET is set. Revalidates
 * the shell on success. Never throws to the client.
 */
export async function shareDeliveryLink(
  engagementId: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  // Resolve the link origin BEFORE the state change: an origin we cannot
  // resolve must not leave behind a committed transition whose link the caller
  // never receives.
  const origin = await resolveRequestOrigin();
  if (!origin) return { ok: false, error: 'generic' };
  const res = await mintDeliveryLinkCore(ctx, engagementId);
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  const link = await deliveryLink(origin, res.data);
  refreshApp();
  return { ok: true, link };
}

/**
 * Server-action wrapper for {@link rotateDeliveryLinkCore}: replaces the link
 * (the previous token stops working) and returns the fresh absolute URL.
 * Revalidates the shell on success. Never throws to the client.
 */
export async function rotateDeliveryLink(
  engagementId: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  // Resolve the link origin BEFORE the state change: an origin we cannot
  // resolve must not leave behind a committed transition whose link the caller
  // never receives.
  const origin = await resolveRequestOrigin();
  if (!origin) return { ok: false, error: 'generic' };
  const res = await rotateDeliveryLinkCore(ctx, engagementId);
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  const link = await deliveryLink(origin, res.data);
  refreshApp();
  return { ok: true, link };
}

/**
 * Server-action wrapper for {@link revokeDeliveryLinkCore}: turns the client link
 * off (the portal 404s). Revalidates the shell on success. Never throws.
 */
export async function revokeDeliveryLink(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await revokeDeliveryLinkCore(ctx, engagementId);
  if (res.ok) refreshApp();
  return res;
}
