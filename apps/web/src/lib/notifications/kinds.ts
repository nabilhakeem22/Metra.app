// Server-safe notification-kind union (plain module — importable by both server
// cores and 'use client' feed components without a client-reference proxy).
// `kind` groups notifications for the feed (icon/label); `body_key` localizes the
// text at render time (never store rendered copy). Western numerals in params.

export const NOTIFICATION_KINDS = [
  'followup_reminder',
  'expire_nudge',
  'portfolio_digest',
  'stage_reminder',
  'client_responded',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * The body keys a `client_responded` notification carries: one per act the
 * client takes on the delivery portal. Written by the token SDF
 * `app_delivery_notify_studio_by_token` (which accepts `client_[a-z_]+`), with
 * params `{ number, year, titleAr, titleEn, count }`, plus `milestoneKind` on a
 * payment claim. A repeat while unread bumps `count` instead of adding a row.
 */
export const CLIENT_RESPONDED_BODY_KEYS = [
  'client_concept_approved',
  'client_concept_chosen',
  'client_concept_changes_requested',
  'client_design_approved',
  'client_design_changes_requested',
  'client_budget_acknowledged',
  'client_handover_acknowledged',
  'client_payment_claimed',
  'client_commented',
] as const;

export type ClientRespondedBodyKey = (typeof CLIENT_RESPONDED_BODY_KEYS)[number];
