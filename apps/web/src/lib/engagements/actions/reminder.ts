'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import { deliveryPortalUrl, requestLocaleOrDefault } from '../portal-url';
import { emailDeliveryReminderCore } from '../reminder/email';
import { prepareDeliveryReminderCore, type DeliveryReminder } from '../reminder/prepare';
import { revealDeliveryLinkCore } from '../share-reveal';

// Round B (B11): the studio sees and resends the client link the client already
// holds. Every wrapper resolves the public origin first (null in production
// without NEXT_PUBLIC_APP_URL: `generic`, never a link to a forged host), and
// never logs the link. Owner/admin only: the cores gate on engagements_issue.

/** The existing client link as an absolute URL in the studio user's locale. Never rotates. */
export async function revealDeliveryLink(
  engagementId: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  const origin = await resolveRequestOrigin();
  if (!origin) return { ok: false, error: 'generic' };
  const res = await revealDeliveryLinkCore(ctx, engagementId);
  if (!res.ok || !res.data) return { ok: false, error: res.error ?? 'generic' };
  return { ok: true, link: deliveryPortalUrl(origin, await requestLocaleOrDefault(), res.data) };
}

/** What the "Send reminder" dialog shows: the WhatsApp text per locale, the number, the email. */
export async function prepareDeliveryReminder(
  engagementId: string,
): Promise<ActionResult & { data?: DeliveryReminder }> {
  const ctx = await requireOrg();
  const origin = await resolveRequestOrigin();
  if (!origin) return { ok: false, error: 'generic' };
  return prepareDeliveryReminderCore(ctx, engagementId, origin);
}

/** Email the reminder to the client, in `locale`. */
export async function emailDeliveryReminder(
  engagementId: string,
  locale: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const origin = await resolveRequestOrigin();
  if (!origin) return { ok: false, error: 'generic' };
  return emailDeliveryReminderCore(ctx, { engagementId, locale }, origin);
}
