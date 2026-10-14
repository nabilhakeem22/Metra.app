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
} as const satisfies Record<string, readonly string[]>;

export type FieldCode = keyof typeof FIELD_CODE_PARAMS;

export function isFieldCode(code: string): code is FieldCode {
  return Object.prototype.hasOwnProperty.call(FIELD_CODE_PARAMS, code);
}
