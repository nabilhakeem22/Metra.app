// Error codes of the design engagements (deliveries): lifecycle, guards, the
// client link and reminders, payment claims, the ROM band, offline approval and
// the concept choice. Pure (no server-only deps).
// The full union is `ActionCode` in `lib/actions/result.ts`.
export type EngagementActionCode =
  | 'engagement_title_required'
  | 'engagement_client_required'
  | 'engagement_project_required'
  | 'engagement_not_found'
  | 'engagement_not_active'
  | 'illegal_trigger'
  | 'engagement_state_conflict'
  | 'guard_scope_inputs_missing'
  | 'design_fee_required'
  | 'milestone_split_invalid'
  | 'milestone_kind_duplicate'
  | 'payment_amount_invalid'
  | 'deposit_not_cleared'
  | 'gate_a_not_cleared'
  | 'gate_b_not_cleared'
  | 'rom_not_acknowledged'
  | 'as_built_not_reconciled'
  | 'spatial_base_missing'
  | 'concept_options_out_of_range'
  | 'revision_co_amount_required'
  | 'revision_cos_outstanding'
  | 'renders_missing'
  | 'as_built_not_due'
  | 'shop_drawings_missing'
  | 'boq_missing'
  | 'balance_not_cleared'
  | 'handoff_not_acknowledged'
  // The client has not answered the review round (client-review.ts): a payment
  // was recorded, the implicit advance waits for them.
  | 'client_review_pending'
  // "Client approved offline" input a retry can never fix (offline-approval.ts).
  | 'offline_approval_date_out_of_range'
  | 'offline_approval_note_too_long'
  // The client answered the review on the portal while the studio was recording
  // an offline approval (offline-approval-input.ts): reload and read their answer.
  | 'client_review_answered'
  // An offline concept choice of an option with no letter (offline-provenance.ts).
  | 'concept_option_not_found'
  // Round B, B11: the client link cannot be re-derived (minted before re-derivable
  // links, or the Worker secret is missing/rotated); one confirmed replacement fixes it.
  | 'delivery_link_unrecoverable'
  // A reminder email with no client address on file.
  | 'client_email_missing'
  // The reminder email did not go out (Resend refused or timed out).
  | 'reminder_email_failed'
  // There is no live client link to reveal or resend (never shared, or revoked):
  // the studio shares one, it is not a "legacy" link to replace.
  | 'delivery_link_not_shared'
  // SHARE_LINK_SECRET is missing or too short: no link can be re-derived, and a
  // replacement would not fix it. A server configuration matter.
  | 'delivery_links_not_configured'
  // An email reminder for this delivery went out less than 15 minutes ago.
  | 'reminder_too_soon'
  | 'handoff_not_open'
  | 'rom_range_invalid'
  | 'rom_not_set'
  | 'rom_not_issued'
  | 'rom_already_issued'
  // Retracting a ledger row (corrections.ts).
  | 'event_not_found'
  | 'already_corrected'
  | 'off_plan_locked'
  | 'flow_not_enabled'
  | 'payment_kind_mismatch'
  | 'ending_requires_explicit_choice'
  | 'project_delivery_exists'
  | 'project_delivery_limit_reached'
  | 'claim_not_found'
  | 'claim_already_settled'
  | 'claim_pending_for_milestone';
