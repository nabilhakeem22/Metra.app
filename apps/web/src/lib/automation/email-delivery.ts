import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { AutomationResult, RecipientEmailLookup } from './types';

/** What happened to one automation email. */
export type EmailOutcome = 'sent' | 'failed' | 'no-address';

/**
 * Look the recipient up and, if they have an address, send. Never throws: a
 * failed or timed-out lookup is a `failed` email (the address exists, we could
 * not reach it), a user with no email on file is `no-address`, and a send that
 * throws despite its never-throw contract is `failed` too.
 */
export async function emailRecipient(
  lookupRecipientEmail: RecipientEmailLookup,
  userId: string,
  send: (to: string) => Promise<{ sent: boolean }>,
): Promise<EmailOutcome> {
  const recipient = await lookupRecipientEmail(userId);
  if (recipient.status === 'no-address') return 'no-address';
  if (recipient.status === 'failed') return 'failed';
  try {
    const { sent } = await send(recipient.email);
    return sent ? 'sent' : 'failed';
  } catch (err) {
    console.error('automation email send threw:', loggableFailure(err));
    return 'failed';
  }
}

/** Add one email's outcome to a core's tallies. `no-address` counts nowhere. */
export function countEmailOutcome(result: AutomationResult, outcome: EmailOutcome): void {
  if (outcome === 'sent') result.emailsSent += 1;
  else if (outcome === 'failed') result.emailsFailed += 1;
}
