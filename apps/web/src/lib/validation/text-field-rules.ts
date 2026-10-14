// The label-free rules over free text, each the refusal under its field or
// null. Pure and client-safe, beside the money and collection rules in
// ./field-rules: a form's pre-check and the server core call the same rule.
import type { FieldError } from '@/lib/actions/field-errors';
import { clean, countCharacters } from './text';

/** Nothing but whitespace was typed. */
export function requiredText(value: string | null | undefined): FieldError | null {
  return clean(value) === null ? { code: 'required' } : null;
}

/** Longer than `max` characters (code points, the unit Postgres counts), once trimmed. */
export function maxCharacters(value: string | null | undefined, max: number): FieldError | null {
  const trimmed = clean(value);
  return trimmed !== null && countCharacters(trimmed) > max
    ? { code: 'too_long', params: { max } }
    : null;
}
