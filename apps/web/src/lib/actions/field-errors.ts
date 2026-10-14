// Field errors: the refusals a person can fix, each under the field that caused
// it. Pure and client-safe, so a form's pre-check and the server core build the
// same map from the same rules.
import type { FieldCode } from './field-codes';
import { ActionError, type ActionCode, type ActionResult } from './result';

/** The ICU values a message is formatted with. */
export type MessageParams = Readonly<Record<string, string | number>>;

/** One field's refusal: a label-free rule, or a domain code with its own sentence. */
export interface FieldError {
  readonly code: FieldCode | ActionCode;
  readonly params?: MessageParams;
}

/**
 * Path to error. A path is the action input property name ('phone'), a declared
 * pair ('name', for the either-or Arabic/English name), or a row path
 * 'lines.<rowKey>.<column>' / 'sections.<rowKey>.name' (row keys, never array
 * indexes, so an error survives a reorder).
 */
export type FieldErrors<F extends string = string> = Partial<Readonly<Record<F, FieldError>>>;

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

function requireSome(errors: FieldErrors): void {
  // An empty map would answer "fix the fields" with nothing under any field.
  if (!hasFieldErrors(errors)) throw new Error('fieldsFailed: empty');
}

/** The answer of an action that refuses its input: every field error at once. */
export function fieldsFailed<F extends string>(errors: FieldErrors<F>): ActionResult {
  requireSome(errors);
  return { ok: false, error: 'check_fields', fields: errors };
}

/** The same answer, thrown inside a mutation (mutateInOrg returns it as is). */
export function failFields<F extends string>(errors: FieldErrors<F>): never {
  requireSome(errors);
  throw new ActionError('check_fields', { fields: errors });
}
