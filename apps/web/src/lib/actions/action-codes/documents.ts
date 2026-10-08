// Error codes of the documents: proposals, the proposal builder, BOQs,
// contracts, variations and BOQ line editing. Pure (no server-only deps).
// The full union is `ActionCode` in `lib/actions/result.ts`.
export type DocumentActionCode =
  | 'proposal_not_draft'
  // The proposal builder (proposals/core/draft-save*.ts, the autosave hook).
  | 'draft_changed_elsewhere'
  | 'draft_too_large'
  | 'draft_incomplete'
  | 'line_required'
  | 'discount_out_of_range'
  | 'supervision_out_of_range'
  | 'tax_out_of_range'
  | 'too_many_lines'
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
