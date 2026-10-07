import 'server-only';
// Everything the studio's "Send reminder" dialog needs (Round B, B11): the
// WhatsApp text in both portal languages, each carrying the link the client
// ALREADY holds (re-derived, never rotated), the number to open WhatsApp on,
// and whether an email can be sent. Owner/admin only, server-enforced; every
// preparation is audited, because it reveals the client's link.
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import type { Locale } from '@/i18n/routing';
import { DELIVERY_LINK_GATE, readLiveDeliveryLink } from '../share-reveal';
import { reminderMessages, type ReminderMessages } from './message';
import { readReminderRecipient } from './recipient';
import { whatsappDigits } from './whatsapp';

export interface DeliveryReminder {
  /** organizations.default_locale: the language the dialog opens in. */
  defaultLocale: Locale;
  /** The WhatsApp text per portal locale, each embedding the link for that locale. */
  messages: ReminderMessages;
  /** International digits for wa.me, or null (WhatsApp then opens without a chat). */
  whatsappDigits: string | null;
  /** Where "Send by email" would go, or null when there is no address. */
  clientEmail: string | null;
}

/**
 * Codes: `forbidden` (not owner/admin), `engagement_not_found`,
 * `engagement_not_active` (closed or abandoned), `delivery_link_unrecoverable`
 * (no live link, or one that cannot be re-derived: the dialog then offers ONE
 * confirmed replacement). Reads only; never rotates. Never throws.
 */
export async function prepareDeliveryReminderCore(
  ctx: OrgContext,
  engagementId: string,
  origin: string,
): Promise<ActionResult & { data?: DeliveryReminder }> {
  const read = await mutateInOrg(ctx, DELIVERY_LINK_GATE, async (tx, audit) => {
    const link = await readLiveDeliveryLink(tx, engagementId, { activeOnly: true });
    const recipient = await readReminderRecipient(tx, ctx.orgId, link.clientId);
    await audit({
      entity: 'design_engagement',
      entityId: engagementId,
      action: 'issue',
      before: { revealed: false },
      after: { revealed: true, reminder: 'prepared' },
    });
    return { rawToken: link.raw, recipient };
  });
  if (!read.ok || !read.data) return { ok: false, error: read.error ?? 'generic' };

  const { rawToken, recipient } = read.data;
  try {
    return {
      ok: true,
      data: {
        defaultLocale: recipient.defaultLocale,
        messages: reminderMessages({ origin, rawToken, recipient }),
        whatsappDigits: whatsappDigits(recipient.phone),
        clientEmail: recipient.email,
      },
    };
  } catch {
    // A fixed line: whatever failed was formatting a text that carries the link.
    console.error('delivery reminder text failed');
    return err('generic');
  }
}
