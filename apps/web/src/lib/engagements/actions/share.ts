'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  mintDeliveryLinkCore,
  revokeDeliveryLinkCore,
  rotateDeliveryLinkCore,
} from '../share';

/**
 * Absolute origin for a client share link. Prefers the public NEXT_PUBLIC_APP_URL
 * env var (never a secret), else derives it from the request headers. Mirrors the
 * proposal/contract share-link origin resolver.
 */
async function resolveOrigin(): Promise<string> {
  const override = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (override) return override;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('cannot resolve request origin for share link');
  return `${proto}://${host}`;
}

/** Build the durable public portal URL for a freshly-minted RAW token. */
async function deliveryLink(rawToken: string): Promise<string> {
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  const origin = await resolveOrigin();
  return `${origin}/${locale}/d/${rawToken}`;
}

/**
 * Server-action wrapper for {@link mintDeliveryLinkCore}: mints the FIRST client
 * share link and returns its absolute URL ONCE (`link`) — the raw token is never
 * re-retrievable. Revalidates the shell on success. Never throws to the client.
 */
export async function shareDeliveryLink(
  engagementId: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  const res = await mintDeliveryLinkCore(ctx, engagementId);
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  const link = await deliveryLink(res.data);
  revalidatePath('/', 'layout');
  return { ok: true, link };
}

/**
 * Server-action wrapper for {@link rotateDeliveryLinkCore}: replaces the link
 * (the previous token stops working) and returns the fresh absolute URL ONCE.
 * Revalidates the shell on success. Never throws to the client.
 */
export async function rotateDeliveryLink(
  engagementId: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  const res = await rotateDeliveryLinkCore(ctx, engagementId);
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  const link = await deliveryLink(res.data);
  revalidatePath('/', 'layout');
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
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
