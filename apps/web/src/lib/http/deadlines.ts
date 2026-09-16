// How long Metra will wait on somebody else's HTTP origin. PURE: no server-only,
// no dependency on the things it bounds.
//
// The database path has had a deadline since wave 2 (`CF_DB_DEADLINE_MS` in
// lib/db/client.ts). Every OTHER outbound call had none: the Supabase service
// client was built with no `global.fetch` override and Resend's SDK was awaited
// bare, so a hung Storage or Resend origin held the server action open until the
// platform killed the whole request. For `sendProposal` that is the worst shape
// available — the proposal IS sent and the share link IS minted, and the studio
// never gets the answer the action exists to return.

/**
 * Supabase Storage. Generous next to a healthy call (bucket lookups and URL
 * signings are milliseconds) because the same client also uploads a rendered
 * PDF, and deliberately at the DB path's ceiling: past this, whatever is wrong
 * is not going to be fixed by waiting longer inside one request.
 */
export const STORAGE_TIMEOUT_MS = 15_000;

/**
 * Resend. Much tighter, because sending email is BEST-EFFORT by design: the
 * proposal is already committed and the share link already minted, so the honest
 * answer after five seconds is `emailSent: false` and a studio that can copy the
 * link — not a spinner that outlives their patience.
 */
export const EMAIL_TIMEOUT_MS = 5_000;

/** A third-party origin took longer than we are willing to wait. */
export class HttpDeadlineError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} exceeded ${timeoutMs}ms`);
    this.name = 'HttpDeadlineError';
  }
}

/**
 * `work`, or an `HttpDeadlineError` — whichever comes first.
 *
 * For an SDK that gives no way to pass an `AbortSignal` (Resend's does not). The
 * underlying request is NOT cancelled, so this bounds the WAIT rather than the
 * work; that is the right trade for a best-effort send, where the caller's
 * answer matters and the socket's fate does not. Where a signal can be passed —
 * the Supabase client — pass one instead, and actually abort.
 *
 * The timer is always cleared, so a fast success never keeps an isolate alive.
 */
export function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HttpDeadlineError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
