// The label-free field rules every domain's field-rules module composes. Pure
// and client-safe: a form's pre-check and the server core call the same rule,
// so the message under the field is the one the server would have sent.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import type { ReadMoneyResult } from '@/lib/money/read';

/** Why a money read failed, as the refusal under its field; null when it read. */
export function moneyRefusal(read: ReadMoneyResult): FieldError | null {
  if (read.ok) return null;
  return read.reason === 'too_large' ? { code: 'amount_too_large' } : { code: 'not_a_number' };
}

/** Keep the fields that broke a rule; every one of them, not the first (D1). */
export function collectFieldErrors<F extends string>(
  checks: Readonly<Record<F, FieldError | null>>,
): FieldErrors<F> {
  const errors: Partial<Record<F, FieldError>> = {};
  for (const field of Object.keys(checks) as F[]) {
    const error = checks[field];
    if (error) errors[field] = error;
  }
  return errors;
}
