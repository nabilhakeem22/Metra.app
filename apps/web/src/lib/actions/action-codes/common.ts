// Error codes shared across the app: auth, validation, generic failures, team,
// clients, projects, dates, files and public links. Pure (no server-only deps).
// The full union is `ActionCode` in `lib/actions/result.ts`.
export type CommonActionCode =
  | 'forbidden'
  | 'generic'
  | 'uncertain'
  // The input broke field rules; `fields` says which, under each field.
  | 'check_fields'
  // A deadlock rolled this attempt back; its partner may be an earlier attempt
  // of the same act, so it is not a definite refusal (retry-policy.ts).
  | 'busy'
  // A seed of the market price book waited past the lock timeout for the book
  // (a publish or withdrawal rebuilding it) or for another seed of the same
  // studio. Its transaction had written NOTHING yet, and a seed is idempotent,
  // so unlike `uncertain` it is safe to say so and to try again.
  | 'market_book_busy'
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
  // Accepting an invitation (team/actions/accept.ts): each cause its own sentence.
  | 'invite_expired'
  | 'invite_wrong_account'
  | 'invite_not_found'
  | 'otp_verify_failed'
  // Supabase refused to send a sign-in code, by cause (lib/auth/otp-failure.ts).
  | 'otp_rate_limited'
  // Too many code CHECKS (our throttle or Supabase's): the code held is still
  // good, so wait and type it again, never ask for a new one (fix round 2, F6).
  | 'otp_verify_rate_limited'
  // A member asked for an expensive studio read too often in a short time
  // (lib/cf/studio-read-rate-limit.ts): wait a minute and ask again.
  | 'rate_limited'
  // The studio used today's email allowance (lib/email/daily-caps.ts): the
  // delivery reminder refuses, since its email IS the action.
  | 'daily_email_cap_reached'
  | 'otp_sms_unavailable'
  | 'otp_email_unavailable'
  // Supabase refused the sign-in challenge token (lib/auth/otp-failure.ts), or
  // the widget failed in the browser.
  | 'otp_captcha_failed'
  // Client only: the login form has no challenge token yet, so nothing was sent.
  | 'otp_captcha_pending'
  | 'immutable'
  | 'code_required'
  | 'code_taken'
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
  // The studio phone on the client page: the rule of org/studio-phone.ts.
  | 'studio_phone_invalid'
  | 'whatsapp_invalid'
  | 'iban_invalid'
  | 'bank_name_required'
  | 'account_number_invalid'
  | 'client_page_details_owner_only'
  | 'client_page_details_stale'
  | 'expected_date_out_of_range';
