// The rule an API key's label keeps. Plain and client-safe (no server-only, no
// db), so the Settings card and the mint core share it.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { boundedText, requiredText } from '@/lib/validation/text-field-rules';

/** Max length of a user-supplied API key label. */
export const MAX_API_KEY_LABEL_LEN = 80;

export const API_KEY_FIELDS = ['label'] as const;

export type ApiKeyField = (typeof API_KEY_FIELDS)[number];

/** A label is required, and capped. */
export function apiKeyFieldErrors(input: { label: string }): FieldErrors<ApiKeyField> {
  return collectFieldErrors<ApiKeyField>({
    label: requiredText(input.label) ?? boundedText(input.label, MAX_API_KEY_LABEL_LEN),
  });
}
