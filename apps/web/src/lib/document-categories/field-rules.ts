// The rule a document category's names keep. Pure and client-safe: the
// Settings card runs it before sending, the core again on what arrived.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { clean } from '@/lib/validation/text';
import { bilingualNameErrors, type BilingualNameField } from '@/lib/validation/text-field-rules';

/** The bilingual DB CHECK's cap on each name. */
const CATEGORY_NAME_MAX = 80;

export interface DocumentCategoryInput {
  nameEn?: string | null;
  nameAr?: string | null;
}

/** One of the two names, neither over the cap; each refusal under its field. */
export function documentCategoryNameErrors(input: DocumentCategoryInput): FieldErrors<BilingualNameField> {
  return bilingualNameErrors(clean(input.nameEn), clean(input.nameAr), CATEGORY_NAME_MAX);
}
