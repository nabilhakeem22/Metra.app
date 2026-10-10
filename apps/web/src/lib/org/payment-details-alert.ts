import 'server-only';
// The email half of the payment-details alert (Round C, owner decision Oct 10).
// The in-app notifications were written in the save's own transaction; these
// emails start once it has committed and run in `after()`, so the owner's Save
// never waits on the mail provider. Through the same per-recipient lookup and
// the same circuit breaker the automation emails use; nothing goes to a client.
import { after } from 'next/server';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settleWithConcurrency } from '@/lib/automation/concurrency';
import { createEmailBreaker } from '@/lib/automation/email-breaker';
import { emailRecipient, type EmailOutcome } from '@/lib/automation/email-delivery';
import { createRecipientEmailLookup } from '@/lib/automation/recipients';
import { sendPaymentDetailsChangedEmail } from '@/lib/email/org-senders';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import type { PaymentDetailsAlert } from './client-page-details-core';

/** Recipients in flight at once, as for a client act's emails (a Worker holds six sockets). */
const ALERT_EMAIL_CONCURRENCY = 4;

/** Email every owner and admin. Logs counts only: no user id, no address. Never throws. */
async function emailAlert(alert: PaymentDetailsAlert, settingsUrl: string): Promise<void> {
  try {
    const lookupRecipientEmail = createRecipientEmailLookup();
    const breaker = createEmailBreaker();
    const settled = await settleWithConcurrency(alert.recipientUserIds, ALERT_EMAIL_CONCURRENCY, (userId) =>
      emailRecipient(
        lookupRecipientEmail,
        userId,
        (to) =>
          sendPaymentDetailsChangedEmail({
            to,
            changedBy: alert.changedBy,
            fields: alert.fields,
            settingsUrl,
            locale: alert.locale,
          }),
        breaker,
      ),
    );
    const outcomes = settled.map((entry): EmailOutcome => (entry.status === 'fulfilled' ? entry.value : 'failed'));
    console.info('payment details alert email:', {
      sent: outcomes.filter((outcome) => outcome === 'sent').length,
      failed: outcomes.filter((outcome) => outcome === 'failed').length,
    });
  } catch (err) {
    console.error('payment details alert email failed:', loggableFailure(err));
  }
}

/**
 * Start the alert's emails after the response. The origin is read BEFORE
 * `after()`, while the request is still open. Never throws.
 */
export async function schedulePaymentDetailsAlertEmails(alert: PaymentDetailsAlert): Promise<void> {
  if (alert.recipientUserIds.length === 0) return;
  try {
    const origin = await resolveRequestOrigin();
    if (!origin) {
      console.error('payment details alert email skipped: no app origin');
      return;
    }
    const emails = emailAlert(alert, `${origin}/${alert.locale}/settings#client-page`);
    after(() => emails);
  } catch (err) {
    console.error('payment details alert email not scheduled:', loggableFailure(err));
  }
}
