// Server-safe notification-kind constants (plain module — importable by both
// server cores and 'use client' feed components without a client-reference proxy).
// `kind` groups notifications for the feed (icon/label); `body_key` localizes the
// text at render time (never store rendered copy). Western numerals in params.

export const NOTIFICATION_KINDS = [
  'followup_reminder',
  'expire_nudge',
  'portfolio_digest',
  'stage_reminder',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
