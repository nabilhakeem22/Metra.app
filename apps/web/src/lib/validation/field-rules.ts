// The label-free field rules every domain's field-rules module composes. Pure
// and client-safe: a form's pre-check and the server core call the same rule,
// so the message under the field is the one the server would have sent.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { readMoney, type ReadMoneyOptions } from '@/lib/money/read';

export type MoneyFieldRead = { ok: true; value: string } | { ok: false; error: FieldError };

/**
 * A typed money box read under `options`, or the refusal under its field. A
 * figure that reads once its minus sign is allowed is said as "below zero",
 * not as "not a number": the studio can see it is a number.
 */
export function readMoneyField(
  raw: string | null | undefined,
  options: ReadMoneyOptions,
): MoneyFieldRead {
  const read = readMoney(raw, options);
  if (read.ok) return read;
  if (read.reason === 'too_large') return { ok: false, error: { code: 'amount_too_large' } };
  const negative = !options.allowNegative && readMoney(raw, { ...options, allowNegative: true }).ok;
  return { ok: false, error: { code: negative ? 'not_negative' : 'not_a_number' } };
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
