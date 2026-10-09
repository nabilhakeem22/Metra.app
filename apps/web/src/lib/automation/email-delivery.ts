import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { EmailDispatchResult } from '@/lib/email/dispatch';
import { settleWithConcurrency } from './concurrency';
import type { EmailBreaker } from './email-breaker';
import type { AutomationResult, RecipientEmailLookup } from './types';

/** What happened to one automation email. */
export type EmailOutcome = 'sent' | 'failed' | 'no-address';

/**
 * One org's owner and admin emails in flight at once. The runner works on
 * ORG_CONCURRENCY = 3 orgs and each org's database connection is idle once its
 * transaction has committed, so 3 x 2 stays inside Cloudflare's six open
 * connections per invocation (the bound CLIENT_ACT_EMAIL_CONCURRENCY observes
 * for a single request). Past six, a send queues while its deadline runs.
 */
export const OWNER_EMAIL_CONCURRENCY = 2;

/**
 * Look the recipient up and, if they have an address, send. Never throws: a
 * failed or timed-out lookup is a `failed` email (the address exists, we could
 * not reach it), a user with no email on file is `no-address`, and a send that
 * throws despite its never-throw contract is `failed` too. With a tick's
 * `breaker` open, nothing is looked up or sent: `failed`.
 */
export async function emailRecipient(
  lookupRecipientEmail: RecipientEmailLookup,
  userId: string,
  send: (to: string) => Promise<EmailDispatchResult>,
  breaker?: EmailBreaker,
): Promise<EmailOutcome> {
  if (breaker?.open) return 'failed';
  const { outcome, transient } = await lookupAndSend(lookupRecipientEmail, userId, send);
  breaker?.record(outcome, transient);
  return outcome;
}

/** The outcome, and whether a failure was transient (a lookup that failed or timed out, a send that did). */
async function lookupAndSend(
  lookupRecipientEmail: RecipientEmailLookup,
  userId: string,
  send: (to: string) => Promise<EmailDispatchResult>,
): Promise<{ outcome: EmailOutcome; transient: boolean }> {
  const recipient = await lookupRecipientEmail(userId);
  if (recipient.status === 'no-address') return { outcome: 'no-address', transient: false };
  if (recipient.status === 'failed') return { outcome: 'failed', transient: true };
  try {
    const result = await send(recipient.email);
    return result.sent ? { outcome: 'sent', transient: false } : { outcome: 'failed', transient: result.transient ?? true };
  } catch (err) {
    console.error('automation email send threw:', loggableFailure(err));
    return { outcome: 'failed', transient: true };
  }
}

/** Add one email's outcome to a core's tallies. `no-address` counts nowhere. */
export function countEmailOutcome(result: AutomationResult, outcome: EmailOutcome): void {
  if (outcome === 'sent') result.emailsSent += 1;
  else if (outcome === 'failed') result.emailsFailed += 1;
}

/**
 * Email each of an org's owners and admins, OWNER_EMAIL_CONCURRENCY at a time,
 * through the tick's breaker, and count every outcome into `result`.
 */
export async function emailEachRecipient(
  deps: { lookupRecipientEmail: RecipientEmailLookup; emailBreaker: EmailBreaker },
  userIds: readonly string[],
  send: (to: string) => Promise<EmailDispatchResult>,
  result: AutomationResult,
): Promise<void> {
  const settled = await settleWithConcurrency(userIds, OWNER_EMAIL_CONCURRENCY, (userId) =>
    emailRecipient(deps.lookupRecipientEmail, userId, send, deps.emailBreaker),
  );
  for (const entry of settled) countEmailOutcome(result, entry.status === 'fulfilled' ? entry.value : 'failed');
}
