import 'server-only';
// What a code request writes to the log (read with `wrangler tail` or Workers
// Logs). Each line is built from a WHITELIST of fields that describe the
// request's shape: the purpose and the refusal, a wait in seconds. Never the
// token or its hash, the address, the hint, the code or the client's IP.
import type { CodePurpose } from './code-answers';

/** A request the database turned away for its limits or a held row: frequent ones mean a client is stuck. */
export function logCodeRequestRefused(purpose: CodePurpose, refusal: 'too_many' | 'busy', retryAfterSeconds?: number): void {
  console.warn('client code request refused:', retryAfterSeconds === undefined ? { purpose, refusal } : { purpose, refusal, retryAfterSeconds });
}

/** A code that was made but not sent: the client cannot take the act online until email works again. */
export function logCodeNotSent(purpose: CodePurpose, transient: boolean): void {
  console.error('client code email not sent:', { purpose, transient });
}

/**
 * THE ALARM: this code took the platform's day to half of the 80 codes the
 * database allows across every studio (the email provider's free day is 100,
 * shared with invites and automation). Past 80 every client is refused a code
 * until the oldest is a day old, so this is the line to alert on.
 */
export function alertPlatformCodesHalfUsed(purpose: CodePurpose): void {
  console.error('ALERT client codes: the platform day has used half its cap', { purpose, half: 40, cap: 80 });
}
