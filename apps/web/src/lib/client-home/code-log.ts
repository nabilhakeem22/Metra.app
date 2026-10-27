import 'server-only';
// What a code request or a code-checked act writes to the log (read with
// `wrangler tail` or Workers Logs). Each line is built from a WHITELIST of
// fields that describe the request's shape: the purpose and the refusal, the
// limit that fired and its wait, the email provider's status. Never the token
// or its hash, the address, the hint, the code or the client's IP.
import type { ResendRefusal } from '@/lib/email/resend-failure';
import type { CodeLimit, CodePurpose } from './code-answers';

/** A request turned away for a limit (named, H5 reliability R6) or a held row: frequent ones mean a client is stuck. */
export function logCodeRequestRefused(
  purpose: CodePurpose,
  refusal: { kind: 'too_many'; limit: CodeLimit; retryAfterSeconds: number } | { kind: 'busy' },
): void {
  console.warn('client code request refused:', { purpose, refusal: refusal.kind, ...(refusal.kind === 'too_many' ? { limit: refusal.limit, retryAfterSeconds: refusal.retryAfterSeconds } : {}) });
}

/** A code-checked act its token function answered `busy` (a held row): frequent ones mean a stuck studio transaction (H6.2 R-L6). */
export function logCodeActBusy(purpose: CodePurpose): void {
  console.warn('client code act refused:', { purpose, refusal: 'busy' });
}

/**
 * A code that was made but not sent: the client cannot take the act online
 * until email works again. `refusal` is what the provider answered (its status
 * and error name: 403 is an unverified domain, 429 its rate limit), absent
 * when it never answered (a timeout, a network failure, no configuration).
 */
export function logCodeNotSent(purpose: CodePurpose, failure: { transient: boolean; refusal?: ResendRefusal }): void {
  console.error('client code email not sent:', { purpose, transient: failure.transient, ...failure.refusal });
}

/**
 * A code whose email failed could not be marked unsent: it still counts toward
 * the day's limits as if it had gone (rare: the mark is one row of this link).
 */
export function logCodeUnsentNotMarked(purpose: CodePurpose, outcome: 'gone' | 'busy' | 'failed'): void {
  console.error('client code unsent mark failed:', { purpose, outcome });
}

/**
 * THE ALARM: this code took the platform's day to half of the 80 codes the
 * database allows across every studio (the email provider's free day is 100,
 * shared with invites and automation). Said once, by the code that crossed 40
 * (H5 reliability R2). Past 80 every client is refused a code until the oldest
 * is a day old, so this is the line to alert on.
 */
export function alertPlatformCodesHalfUsed(purpose: CodePurpose): void {
  console.error('ALERT client codes: the platform day has used half its cap', { purpose, half: 40, cap: 80 });
}
