// Error codes of execution (Stage 2): the contract generated from an issued
// BOQ, its payment schedule, payment requests and payments, change-order
// charges, the final account, cost entries and site measurements. Pure (no
// server-only deps). The full union is `ActionCode` in `lib/actions/result.ts`.
export type ExecutionActionCode =
  // Execution features apply only to a contract generated from a BOQ.
  | 'contract_not_execution'
  | 'boq_not_issued'
  // The BOQ cannot be re-issued while a live contract stands on it.
  | 'boq_has_contract'
  | 'delivery_not_in_execution'
  // Issuing a BOQ contract needs a schedule that adds up.
  | 'contract_schedule_missing'
  | 'contract_schedule_invalid'
  | 'schedule_too_long'
  | 'contract_not_signed'
  | 'contract_not_active'
  // Payment requests (مطالبة دفع) and the payments against them.
  | 'request_exists'
  | 'request_not_found'
  | 'request_void'
  | 'request_has_payments'
  // Sits under the amount field, with params {outstanding}.
  | 'payment_exceeds_request'
  | 'claim_pending_for_request'
  // Billing an approved change order.
  | 'variation_not_approved'
  | 'variation_credit_not_billable'
  // The final account (الحساب الختامي); `final_account_changed` has params {amount}.
  | 'final_account_issued'
  | 'final_account_nothing_due'
  | 'final_account_changed'
  | 'open_variations'
  // Cost entries and site measurements against the contract's lines.
  | 'cost_entry_not_found'
  | 'cost_entry_voided'
  | 'line_not_in_contract';
