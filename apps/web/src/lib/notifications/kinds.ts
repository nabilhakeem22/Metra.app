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
  'delivery_followup',
  // Round C: someone changed the phone, WhatsApp, InstaPay or bank details the
  // client page shows. Params carry the actor's id; the feed resolves who.
  'client_page_details_changed',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * The body keys a `client_responded` notification carries for an act on the
 * DELIVERY portal (/d). Written by the token SDF
 * `app_delivery_notify_studio_by_token` (which accepts `client_[a-z_]+`), with
 * params `{ number, year, titleAr, titleEn, count }`, plus `milestoneKind` on a
 * payment claim. A repeat while unread bumps `count` instead of adding a row.
 */
export const CLIENT_DELIVERY_BODY_KEYS = [
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

/**
 * The body keys for an act on a CONTRACT link (/c) or a CHANGE-ORDER link (/v)
 * (Stage 2, 0063): written in the same transaction as the client's act by
 * `app_contract_ack_by_token` and `app_variation_respond_by_token`, for every
 * contract, proposal-sourced ones included. Entity `contract` (the contract's
 * id, so the feed opens the contract); params `{ number, year }`: the contract's
 * number for a signature, the CHANGE ORDER's number for a decision, and its
 * creation year in Africa/Cairo.
 */
export const CLIENT_CONTRACT_BODY_KEYS = [
  'client_contract_signed',
  'client_variation_approved',
  'client_variation_rejected',
] as const;

export const CLIENT_RESPONDED_BODY_KEYS = [
  ...CLIENT_DELIVERY_BODY_KEYS,
  ...CLIENT_CONTRACT_BODY_KEYS,
] as const;

export type ClientRespondedBodyKey = (typeof CLIENT_RESPONDED_BODY_KEYS)[number];
export type ClientContractBodyKey = (typeof CLIENT_CONTRACT_BODY_KEYS)[number];
