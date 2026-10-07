// Unified action result + error codes (A4). Pure — no server-only deps, so it is
// importable from client mappers and unit tests. UI localizes each code via
// resolveActionError -> t(`errors.${code}`).
export type ActionCode =
  | 'forbidden'
  | 'invalid'
  | 'generic'
  | 'uncertain'
  | 'name_required'
  | 'phone_required'
  | 'start_date_required'
  | 'project_limit_reached'
  | 'last_owner'
  | 'owner_immutable'
  | 'self'
  | 'already_member'
  | 'pending_exists'
  | 'declined'
  | 'otp_send_failed'
  | 'otp_verify_failed'
  | 'immutable'
  | 'code_required'
  | 'code_taken'
  | 'invalid_percentage'
  | 'import_empty'
  | 'import_too_large'
  | 'client_required'
  | 'invalid_dates'
  | 'proposal_not_draft'
  | 'line_required'
  | 'token_invalid'
  | 'token_expired'
  | 'already_responded'
  | 'discount_out_of_range'
  | 'supervision_out_of_range'
  | 'tax_out_of_range'
  | 'too_many_lines'
  | 'invalid_date'
  | 'amount_too_large'
  | 'last_primary_contact'
  | 'contract_exists'
  | 'proposal_not_accepted'
  | 'boq_not_found'
  | 'boq_not_draft'
  | 'boq_send_conflict'
  // The PDF renderer is at its concurrency cap after retries: nothing was
  // written, and the same click a few seconds later normally works.
  | 'renderer_busy'
  | 'proposal_is_boq'
  | 'contract_not_draft'
  | 'contract_not_issued'
  | 'contract_not_signable'
  | 'variation_not_draft'
  | 'variation_not_internal_approved'
  | 'variation_not_issued'
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
  | 'firm_type_unavailable'
  | 'project_delivery_exists'
  | 'project_delivery_limit_reached'
  | 'claim_not_found'
  | 'claim_already_settled'
  | 'claim_pending_for_milestone'
  | 'file_too_large'
  // Editing a draft BOQ line by line (boqs/edit.ts + boqs/edit-input.ts).
  | 'line_not_found'
  | 'section_not_found'
  | 'section_name_required'
  | 'section_name_too_long'
  | 'description_required'
  | 'description_too_long'
  | 'item_code_too_long'
  | 'invalid_unit'
  | 'invalid_qty'
  | 'invalid_price'
  | 'invalid_discount';

export interface ActionResult {
  ok: boolean;
  error?: ActionCode;
  link?: string;
  already?: boolean;
}

export function ok(extra?: { link?: string; already?: boolean }): ActionResult {
  return { ok: true, ...extra };
}

export function err(code: ActionCode): ActionResult {
  return { ok: false, error: code };
}

/** Throw inside a mutate core to short-circuit with a coded failure. */
export class ActionError extends Error {
  constructor(public code: ActionCode) {
    super(code);
    this.name = 'ActionError';
  }
}

export function fail(code: ActionCode): never {
  throw new ActionError(code);
}
