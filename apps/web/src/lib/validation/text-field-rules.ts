// The label-free rules over free text, each the refusal under its field or
// null. Pure and client-safe, beside the money and collection rules in
// ./field-rules: a form's pre-check and the server core call the same rule.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from './field-rules';
import { clean, countCharacters, hasControlCharacter } from './text';

/** Nothing but whitespace was typed. */
export function requiredText(value: string | null | undefined): FieldError | null {
  return clean(value) === null ? { code: 'required' } : null;
}

/**
 * A free-text box, once trimmed: `unprintable` when it holds a control
 * character (a paste out of another app), `too_long` past `max` characters
 * (code points, the unit Postgres counts). Exactly `max` is valid.
 */
export function boundedText(value: string | null | undefined, max: number): FieldError | null {
  const trimmed = clean(value);
  if (trimmed === null) return null;
  if (hasControlCharacter(trimmed)) return { code: 'unprintable' };
  return countCharacters(trimmed) > max ? { code: 'too_long', params: { max } } : null;
}

/** The paths of the either-or Arabic/English name: the pair, then each half. */
export const BILINGUAL_NAME_FIELDS = ['name', 'nameEn', 'nameAr'] as const;

export type BilingualNameField = (typeof BILINGUAL_NAME_FIELDS)[number];

/**
 * One of the two names is enough (said under `name`, D5); each one has the
 * cap `max`. The values are already trimmed (`clean`), blank as null.
 */
export function bilingualNameErrors(
  nameEn: string | null,
  nameAr: string | null,
  max: number,
): FieldErrors<BilingualNameField> {
  return collectFieldErrors<BilingualNameField>({
    name: nameEn || nameAr ? null : { code: 'name_required' },
    nameEn: boundedText(nameEn, max),
    nameAr: boundedText(nameAr, max),
  });
}
