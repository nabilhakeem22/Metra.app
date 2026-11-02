// The audit `after.reminder` values an email reminder leaves. PURE, constants
// only, so a reader of the audit trail (the cooldown in ./cooldown.ts, the
// rescue ledger, the daily client email cap in lib/email/daily-cap-queries.ts)
// depends on these two strings and nothing else.

/** A reminder email was requested (and the cooldown started). */
export const REMINDER_EMAIL_REQUESTED = 'email';

/** That request's send failed, which lifts the cooldown. */
export const REMINDER_EMAIL_FAILED = 'email_failed';
