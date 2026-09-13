// Server-safe notification-kind union (plain module — importable by both server
// cores and 'use client' feed components without a client-reference proxy).
// `kind` groups notifications for the feed (icon/label); `body_key` localizes the
// text at render time (never store rendered copy). Western numerals in params.

export type NotificationKind =
  | 'followup_reminder'
  | 'expire_nudge'
  | 'portfolio_digest'
  | 'stage_reminder';
