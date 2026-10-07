import 'server-only';
// The email half's scheduling (Round B, B10): resolve the origin while the
// request connection is still open, then START the emails and hand them to
// `after()` so the client's answer never waits for them. The delivery's label
// comes from the notifier's own answer (0057), so nothing more is read here.
import { after } from 'next/server';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import type { ClientAct } from './acts';
import { emailDeliveryLabel } from './email-label';
import { emailClientActRecipients } from './email';
import type { StudioNotified } from './studio-notified';

/**
 * Start the emails for the members with a NEW notification. Every read happens
 * BEFORE `after()`: the request connection is torn down there
 * (lib/db/request-connection.ts). Never throws.
 */
export async function scheduleStudioEmails(act: ClientAct, notified: StudioNotified): Promise<void> {
  try {
    const origin = await resolveRequestOrigin();
    if (!origin) {
      console.error('client act email skipped: no app origin');
      return;
    }
    const emails = emailClientActRecipients({
      userIds: notified.newRecipients,
      act,
      deliveryLabel: emailDeliveryLabel(notified.delivery, notified.locale),
      deliveryUrl: `${origin}/${notified.locale}/engagements/${notified.engagementId}`,
      locale: notified.locale,
    });
    after(() => emails);
  } catch (err) {
    console.error('client act email not scheduled:', loggableFailure(err));
  }
}
