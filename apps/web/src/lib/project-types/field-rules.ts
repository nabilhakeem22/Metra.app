// The rule a project type's names keep. Pure and client-safe: the Details
// tab's add-a-type box runs it before sending, the core again.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { clean } from '@/lib/validation/text';
import { bilingualNameErrors, type BilingualNameField } from '@/lib/validation/text-field-rules';

const TYPE_NAME_MAX = 200;

export interface ProjectTypeInput {
  nameEn?: string | null;
  nameAr?: string | null;
}

/** One of the two names, neither over the cap; each refusal under its field. */
export function projectTypeNameErrors(input: ProjectTypeInput): FieldErrors<BilingualNameField> {
  return bilingualNameErrors(clean(input.nameEn), clean(input.nameAr), TYPE_NAME_MAX);
}
