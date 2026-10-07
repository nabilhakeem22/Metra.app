import 'server-only';
// The email half of "the studio hears the client": one email per member who
// got a NEW notification for this act (a collapsed repeat sends none; the
// notifier decides which, notify.ts). Runs from `after()`, so the client's
// answer never waits for it.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settleWithConcurrency } from '@/lib/automation/concurrency';
import { emailRecipient, type EmailOutcome } from '@/lib/automation/email-delivery';
import { createRecipientEmailLookup } from '@/lib/automation/recipients';
import { sendClientActEmail } from '@/lib/email/delivery-senders';
import { CLIENT_ACT_BODY_KEY, type ClientAct } from './acts';

/**
 * At most this many recipients in flight (lookup, then send). A Worker holds 6
 * outbound connections and queues the rest, while every deadline here is a
 * timer armed when its call STARTS: unbounded, the 7th send's 5 s ran out in a
 * queue before it reached a socket, and a slow Resend failed most of a large
 * studio's emails. Four leaves room for the request's own database sockets,
 * and each recipient's deadlines now start when its slot does.
 */
export const CLIENT_ACT_EMAIL_CONCURRENCY = 4;

export interface ClientActEmailBatch {
  /** Members of the delivery's studio, as the notifier returned them. */
  userIds: string[];
  act: ClientAct;
  deliveryLabel: string;
  deliveryUrl: string;
  /** The studio's default locale. */
  locale: string;
}

/**
 * Email every member in the batch, CLIENT_ACT_EMAIL_CONCURRENCY at a time.
 * Each address is looked up in Supabase auth under AUTH_LOOKUP_TIMEOUT_MS and
 * each send is bounded by EMAIL_TIMEOUT_MS (the automation helpers), so a hung
 * origin is a `failed` email, not a stuck background task. Logs the act key
 * and COUNTS only: no user id, no address, no delivery. Never throws.
 */
export async function emailClientActRecipients(batch: ClientActEmailBatch): Promise<void> {
  try {
    const lookupRecipientEmail = createRecipientEmailLookup();
    const settled = await settleWithConcurrency(
      batch.userIds,
      CLIENT_ACT_EMAIL_CONCURRENCY,
      (userId) =>
        emailRecipient(lookupRecipientEmail, userId, (to) =>
          sendClientActEmail({
            to,
            act: batch.act,
            deliveryLabel: batch.deliveryLabel,
            deliveryUrl: batch.deliveryUrl,
            locale: batch.locale,
          }),
        ),
    );
    const outcomes = settled.map((entry): EmailOutcome =>
      entry.status === 'fulfilled' ? entry.value : 'failed',
    );
    console.info('client act email:', {
      act: CLIENT_ACT_BODY_KEY[batch.act.kind],
      ...countOutcomes(outcomes),
    });
  } catch (err) {
    console.error('client act email failed:', loggableFailure(err));
  }
}

function countOutcomes(outcomes: EmailOutcome[]): { sent: number; failed: number; noAddress: number } {
  return {
    sent: outcomes.filter((outcome) => outcome === 'sent').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    noAddress: outcomes.filter((outcome) => outcome === 'no-address').length,
  };
}
