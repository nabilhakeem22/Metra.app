// A per-tick circuit breaker for automation emails (Round C, R2). PURE: no I/O.
//
// Every automation email waits up to EMAIL_TIMEOUT_MS when Resend hangs. One tick
// sends hundreds at 07:00, so a Resend outage turned into hours of serial waits
// and pushed the tick past the cron's 15-minute ceiling. After EMAIL_BREAKER_LIMIT
// consecutive TRANSIENT failures in one tick (a timeout, a network error, a 5xx,
// a recipient lookup that failed), the rest of that tick's sends are skipped
// (counted as failed; the in-app notifications already carry the content), and
// one line says so. A 4xx refusal is not counted and does not reset the count:
// an unverified sending domain refuses every non-owner recipient with a 4xx, and
// that must not pause the owner's own digest and reminders. The next tick starts
// closed again.
import type { EmailOutcome } from './email-delivery';

export const EMAIL_BREAKER_LIMIT = 5;

export interface EmailBreaker {
  /** True once the tick has stopped sending. */
  readonly open: boolean;
  /** `transient`: the failure was a timeout, a network error or a 5xx (ignored for other outcomes). */
  record(outcome: EmailOutcome, transient: boolean): void;
}

export function createEmailBreaker(limit = EMAIL_BREAKER_LIMIT): EmailBreaker {
  let consecutiveFailures = 0;
  let open = false;
  return {
    get open() {
      return open;
    },
    record(outcome: EmailOutcome, transient: boolean): void {
      if (open || outcome === 'no-address') return;
      if (outcome === 'sent') {
        consecutiveFailures = 0;
        return;
      }
      if (!transient) return;
      consecutiveFailures += 1;
      if (consecutiveFailures >= limit) {
        open = true;
        console.warn('automation emails paused for the rest of this tick', { consecutiveFailures });
      }
    },
  };
}
