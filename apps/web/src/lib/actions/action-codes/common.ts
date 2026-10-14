// Error codes shared across the app: auth, validation, generic failures, team,
// clients, projects, dates, files and public links. Pure (no server-only deps).
// The full union is `ActionCode` in `lib/actions/result.ts`.
export type CommonActionCode =
  | 'forbidden'
  | 'invalid'
  | 'generic'
  | 'uncertain'
  // The input broke field rules; `fields` says which, under each field.
  | 'check_fields'
  // A deadlock rolled this attempt back; its partner may be an earlier attempt
  // of the same act, so it is not a definite refusal (retry-policy.ts).
  | 'busy'
  // Input no form can produce (a forged id, an enum outside its select).
  | 'malformed'
  // The row is gone or moved to another workspace (someone deleted it).
  | 'record_not_found'
  // A logo that is not a PNG, JPG or WebP image of at most 2 MB.
  | 'logo_image_unsupported'
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
  | 'otp_verify_failed'
  // Supabase refused to send a sign-in code, by cause (lib/auth/otp-failure.ts).
  | 'otp_rate_limited'
  | 'otp_sms_unavailable'
  | 'otp_email_unavailable'
  | 'immutable'
  | 'code_required'
  | 'code_taken'
  | 'invalid_percentage'
  | 'import_empty'
  | 'import_too_large'
  | 'client_required'
  | 'invalid_dates'
  | 'token_invalid'
  | 'token_expired'
  | 'already_responded'
  | 'invalid_date'
  // A day that has not happened yet, where only a past day can be true.
  | 'date_in_future'
  | 'amount_too_large'
  | 'last_primary_contact'
  | 'firm_type_unavailable'
  | 'file_too_large'
  // The studio's client page details (Round C, C8).
  | 'phone_invalid'
  | 'whatsapp_invalid'
  | 'iban_invalid'
  | 'bank_name_required'
  | 'account_number_invalid'
  | 'client_page_details_owner_only'
  | 'client_page_details_stale'
  | 'expected_date_out_of_range';
