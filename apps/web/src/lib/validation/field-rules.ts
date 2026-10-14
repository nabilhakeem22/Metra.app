// The label-free field rules every domain's field-rules module composes. Pure
// and client-safe: a form's pre-check and the server core call the same rule,
// so the message under the field is the one the server would have sent.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { readMoney, type ReadMoneyOptions } from '@/lib/money/read';
import { clean, countCharacters } from './text';

/** One typed value as it is stored, or the refusal under its field. */
export type FieldRead<T> = { ok: true; value: T } | { ok: false; error: FieldError };

type ValueOf<R> = R extends { ok: true; value: infer T } ? T : never;

/**
 * A typed money box read under `options`, or the refusal under its field. A
 * figure that reads once its minus sign is allowed is said as "below zero",
 * not as "not a number": the studio can see it is a number.
 */
export function readMoneyField(
  raw: string | null | undefined,
  options: ReadMoneyOptions,
): FieldRead<string> {
  const read = readMoney(raw, options);
  if (read.ok) return read;
  if (read.reason === 'too_large') return { ok: false, error: { code: 'amount_too_large' } };
  const negative = !options.allowNegative && readMoney(raw, { ...options, allowNegative: true }).ok;
  return { ok: false, error: { code: negative ? 'not_negative' : 'not_a_number' } };
}

/** An optional free-text box: trimmed, empty is null, past `max` characters refused. */
export function readOptionalText(value: string | null | undefined, max: number): FieldRead<string | null> {
  const trimmed = clean(value);
  if (trimmed !== null && countCharacters(trimmed) > max) {
    return { ok: false, error: { code: 'too_long', params: { max } } };
  }
  return { ok: true, value: trimmed };
}

/** Every field's value, or every refusal at once under its field (D1). */
export function readFields<R extends Record<string, FieldRead<unknown>>>(
  reads: R,
): { ok: true; values: { [K in keyof R]: ValueOf<R[K]> } } | { ok: false; errors: FieldErrors<keyof R & string> } {
  const values: Record<string, unknown> = {};
  const errors: Partial<Record<string, FieldError>> = {};
  for (const [field, read] of Object.entries(reads)) {
    if (read.ok) values[field] = read.value;
    else errors[field] = read.error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors: errors as FieldErrors<keyof R & string> };
  return { ok: true, values: values as { [K in keyof R]: ValueOf<R[K]> } };
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
