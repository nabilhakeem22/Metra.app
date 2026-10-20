// The label-free rules a single form field can break. Pure and client-safe.
//
// A field error sits UNDER its field, so its sentence never names the field:
// "Too long. Keep it to 120 characters or fewer." reads right under any label,
// and the Arabic copy never has to agree in gender with an interpolated label.
// A domain rule that does need its own sentence (`phone_required`, `code_taken`)
// stays an ActionCode and may sit on a field as it is.

/**
 * Each rule with the ICU arguments its message takes, in order. Runtime-
 * enumerable on purpose: the catalogue tests read it, as they read
 * ACTION_CODE_PROBLEM, so a rule cannot ship without both of its sentences.
 */
export const FIELD_CODE_PARAMS = {
  required: [],
  too_long: ['max'],
  too_short: ['min'],
  out_of_range: ['min', 'max'],
  not_a_number: [],
  not_negative: [],
  email_format: [],
  no_longer_exists: [],
  unprintable: [],
  // A payment schedule whose rows do not add up to what they must (100 for
  // percentages, the contract value for amounts).
  schedule_sum_mismatch: ['expected', 'actual'],
  // A contract value too small for its split: some row would bill nothing,
  // or carry VAT below zero or above its amount.
  schedule_value_too_small: ['value'],
  // A day that has not come yet, where only today or an earlier day is true
  // (the day a client signed on paper).
  date_in_future: [],
  // A day already gone, where only today or a later day makes sense (the day a
  // payment request is due).
  date_in_past: [],
  // A day before the document it records existed (a paper signature dated
  // before the contract was issued); `date` is that issue day, DD/MM/YYYY.
  date_before_issue: ['date'],
  // A figure typed with more decimals than it is kept to (a rate past 4
  // decimals), refused rather than silently cut.
  too_many_decimals: ['max'],
} as const satisfies Record<string, readonly string[]>;

export type FieldCode = keyof typeof FIELD_CODE_PARAMS;

export function isFieldCode(code: string): code is FieldCode {
  return Object.prototype.hasOwnProperty.call(FIELD_CODE_PARAMS, code);
}
