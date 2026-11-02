// Error codes of execution (Stage 2): the contract generated from an issued
// BOQ, its payment schedule, payment requests and payments, change-order
// charges, the final account, cost entries and site measurements. Pure (no
// server-only deps). The full union is `ActionCode` in `lib/actions/result.ts`.
export type ExecutionActionCode =
  // Execution features apply only to a contract generated from a BOQ.
  | 'contract_not_execution'
  | 'boq_not_issued'
  // The contract's client home is not at execution, or shows another contract.
  | 'client_home_unavailable'
  // A terminated contract has no client home to open.
  | 'contract_terminated'
  // The BOQ cannot be re-issued while a live contract stands on it.
  | 'boq_has_contract'
  // Execution starts only once design has finished on the pair's one delivery
  // (lib/engagements/design-first.ts); these two carry {delivery, deliveryId}.
  | 'design_open'
  | 'design_only_closed'
  // The BOQ is not on the delivery whose link would show its contract: a new version fixes it.
  | 'boq_not_on_home'
  // Every delivery of the pair was abandoned: a new delivery fixes it.
  | 'boq_delivery_abandoned'
  // A draft version stands on the project: a contract on the BOQ it replaces would block its issue.
  | 'boq_version_in_progress'
  // A BOQ goes out through a delivery, and the project has no single one to use.
  | 'boq_needs_delivery'
  // The pair has a delivery: its contract comes from that BOQ, not from a proposal.
  | 'contract_from_boq_only'
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
  // A payment's idempotency key already names a DIFFERENT payment (another
  // request, or another amount): refused, never answered as that one.
  | 'idempotency_conflict'
  // Billing an approved change order.
  | 'variation_not_approved'
  | 'variation_credit_not_billable'
  // The final account (الحساب الختامي); `final_account_changed` has params {amount}.
  | 'final_account_issued'
  | 'final_account_nothing_due'
  | 'final_account_changed'
  // Its balance is past the money cap: a reading far beyond its line (A5 S3).
  | 'final_account_too_large'
  | 'open_variations'
  // Cost entries and site measurements against the contract's lines.
  | 'cost_entry_not_found'
  | 'cost_entry_voided'
  | 'line_not_in_contract';
