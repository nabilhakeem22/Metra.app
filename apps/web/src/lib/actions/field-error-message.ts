// A field error as the sentence under its field. Pure; the translator is the
// caller's scoped errors namespace (studio `errors`, portal `portal.errors`).
import type { Translate } from './error-message';
import { isFieldCode } from './field-codes';
import type { FieldError } from './field-errors';

/** A label-free rule reads `field.<code>`; a domain code reads its own message. */
export function describeFieldError(error: FieldError, t: Translate): string {
  const key = isFieldCode(error.code) ? `field.${error.code}` : error.code;
  return error.params ? t(key, error.params) : t(key);
}
