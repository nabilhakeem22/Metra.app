// How long a client's answer may wait on notification work. PURE: shared by the
// notifier (./notify.ts) and the repeat-tap check (./already-notified.ts) without
// either importing the other.

/**
 * The most the client's answer waits for ONE notification call: the notifier
 * write and the email scheduling, or the "was it already notified?" read. The
 * act itself is already committed; past this the portal says "recorded" and the
 * studio still sees the delivery's state. The notifier is a WRITE: a call
 * abandoned here can still commit, so its rows may land without their email.
 */
export const NOTIFY_BUDGET_MS = 2_000;
