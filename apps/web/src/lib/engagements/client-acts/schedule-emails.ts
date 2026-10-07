import 'server-only';
// The email half's scheduling (Round B, B10): resolve the origin and the
// delivery's label while the request connection is still open, then START the
// emails and hand them to `after()` so the client's answer never waits for
// them. The label read runs only inside the notifier's remaining time budget.
import { after } from 'next/server';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { withDeadline } from '@/lib/http/deadlines';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import type { ClientAct } from './acts';
import { deliveryLabelForEmail } from './delivery-label';
import { emailClientActRecipients } from './email';
import type { StudioNotified } from './studio-notified';

/** Below this much budget the label read is skipped: the email reads without it. */
const LABEL_MIN_BUDGET_MS = 150;

/** The delivery's label within the time left, or '' (late, failed, or no time). */
async function labelWithin(
  token: string,
  locale: StudioNotified['locale'],
  remainingMs: number,
): Promise<string> {
  if (remainingMs < LABEL_MIN_BUDGET_MS) return '';
  try {
    return await withDeadline(deliveryLabelForEmail(token, locale), remainingMs, 'client act email label');
  } catch (err) {
    console.error('client act email label skipped:', loggableFailure(err));
    return '';
  }
}

/**
 * Start the emails for the members with a NEW notification. `deadlineAt` is
 * the notifier's budget (a Date.now() instant); the label read never runs past
 * it. Every database read happens BEFORE `after()`: the request connection is
 * torn down there (lib/db/request-connection.ts). Never throws.
 */
export async function scheduleStudioEmails(
  token: string,
  act: ClientAct,
  notified: StudioNotified,
  deadlineAt: number,
): Promise<void> {
  try {
    const origin = await resolveRequestOrigin();
    if (!origin) {
      console.error('client act email skipped: no app origin');
      return;
    }
    const deliveryLabel = await labelWithin(token, notified.locale, deadlineAt - Date.now());
    const emails = emailClientActRecipients({
      userIds: notified.newRecipients,
      act,
      deliveryLabel,
      deliveryUrl: `${origin}/${notified.locale}/engagements/${notified.engagementId}`,
      locale: notified.locale,
    });
    after(() => emails);
  } catch (err) {
    console.error('client act email not scheduled:', loggableFailure(err));
  }
}
