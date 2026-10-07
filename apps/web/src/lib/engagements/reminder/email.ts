import 'server-only';
// "Send by email", the reminder's second channel (Round B, B11): one email to
// the client's address carrying the link they ALREADY hold. Owner/admin only,
// server-enforced, audited, at most once per delivery per cooldown; never
// rotates the link.
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, ok, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { sendDeliveryReminderEmail } from '@/lib/email/delivery-senders';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { deliveryPortalUrl, portalLocale } from '../portal-url';
import { DELIVERY_LINK_GATE, readLiveDeliveryLink } from '../share-reveal';
import {
  REMINDER_EMAIL_FAILED,
  REMINDER_EMAIL_REQUESTED,
  refuseIfRemindedRecently,
} from './cooldown';
import { readReminderRecipient } from './recipient';

/**
 * Codes: `invalid` (a locale the portal does not serve), `forbidden`,
 * `engagement_not_found`, `engagement_not_active`, the link codes of
 * readLiveDeliveryLink, `client_email_missing` (no address on the client or
 * its primary contact), `reminder_too_soon` (one went out within
 * REMINDER_EMAIL_COOLDOWN_MINUTES), `reminder_email_failed` (Resend refused or
 * did not answer within EMAIL_TIMEOUT_MS).
 *
 * The read, the cooldown check and the audit row commit BEFORE the send, so no
 * database transaction waits on the mail provider. That audit row records the
 * REQUEST (and starts the cooldown); a send that fails appends a second row
 * (`email_failed`), which lifts it, so a retry is not blocked. Never throws.
 */
export async function emailDeliveryReminderCore(
  ctx: OrgContext,
  input: { engagementId: string; locale: string },
  origin: string,
): Promise<ActionResult> {
  const locale = portalLocale(input.locale);
  if (!locale) return err('invalid');

  const read = await mutateInOrg(ctx, DELIVERY_LINK_GATE, async (tx, audit) => {
    const link = await readLiveDeliveryLink(tx, input.engagementId, { activeOnly: true });
    const recipient = await readReminderRecipient(tx, ctx.orgId, link.clientId);
    if (!recipient.email) fail('client_email_missing');
    await refuseIfRemindedRecently(tx, input.engagementId);
    await audit({
      entity: 'design_engagement',
      entityId: input.engagementId,
      action: 'issue',
      before: { revealed: false },
      after: { revealed: true, reminder: REMINDER_EMAIL_REQUESTED },
    });
    return { rawToken: link.raw, recipient, to: recipient.email };
  });
  if (!read.ok || !read.data) return { ok: false, error: read.error ?? 'generic' };

  const { rawToken, recipient, to } = read.data;
  const { sent } = await sendDeliveryReminderEmail({
    to,
    clientName: pickLocale(recipient.client, 'name', locale).value,
    studioName: pickLocale(recipient.studio, 'name', locale).value,
    portalUrl: deliveryPortalUrl(origin, locale, rawToken),
    locale,
  });
  if (sent) return ok();
  await recordFailedSend(ctx, input.engagementId);
  return err('reminder_email_failed');
}

/** The send failed: say so in the log of record, which lifts the cooldown. */
async function recordFailedSend(ctx: OrgContext, engagementId: string): Promise<void> {
  const recorded = await mutateInOrg(ctx, DELIVERY_LINK_GATE, (_tx, audit) =>
    audit({
      entity: 'design_engagement',
      entityId: engagementId,
      action: 'issue',
      before: null,
      after: { reminder: REMINDER_EMAIL_FAILED },
    }),
  );
  if (!recorded.ok) {
    console.error('reminder email failure not recorded:', { code: recorded.error });
  }
}
