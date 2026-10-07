import 'server-only';
// The email half of "the studio hears the client": one email per member who
// got a NEW notification for this act (a collapsed repeat sends none; the
// notifier decides which, notify.ts). Runs from `after()`, so the client's
// answer never waits for it.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { emailRecipient, type EmailOutcome } from '@/lib/automation/email-delivery';
import { createRecipientEmailLookup } from '@/lib/automation/recipients';
import { sendClientActEmail } from '@/lib/email/delivery-senders';
import type { ClientAct } from './acts';

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
 * Email every member in the batch, concurrently. Each address is looked up in
 * Supabase auth under AUTH_LOOKUP_TIMEOUT_MS and each send is bounded by
 * EMAIL_TIMEOUT_MS (the automation helpers), so a hung origin is a `failed`
 * email, not a stuck background task. Logs COUNTS only: no user id, no
 * address, no delivery. Never throws.
 */
export async function emailClientActRecipients(batch: ClientActEmailBatch): Promise<void> {
  try {
    const lookupRecipientEmail = createRecipientEmailLookup();
    const outcomes = await Promise.all(
      batch.userIds.map((userId) =>
        emailRecipient(lookupRecipientEmail, userId, (to) =>
          sendClientActEmail({
            to,
            act: batch.act,
            deliveryLabel: batch.deliveryLabel,
            deliveryUrl: batch.deliveryUrl,
            locale: batch.locale,
          }),
        ),
      ),
    );
    console.info('client act email:', countOutcomes(outcomes));
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
