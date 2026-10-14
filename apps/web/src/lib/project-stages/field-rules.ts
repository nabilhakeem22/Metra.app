// The rules a project stage's typed values keep. Pure and client-safe; the
// shape checks no form can fail (ids, the status enum) stay in the core.
import type { StageStatus } from '@metra/db';
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { PERCENT_REFUSAL } from '@/lib/validation/number-field-rules';
import { normalizePercent } from '@/lib/validation/percent';
import { clean } from '@/lib/validation/text';
import { bilingualNameErrors, type BilingualNameField } from '@/lib/validation/text-field-rules';

export const STAGE_FIELDS = ['name', 'nameEn', 'nameAr', 'progressPct', 'startDate', 'endDate'] as const;

export type StageField = (typeof STAGE_FIELDS)[number];

export interface StageInput {
  nameEn?: string | null;
  nameAr?: string | null;
  status?: StageStatus | null;
  progressPct?: string | null;
  sortOrder?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

const NAME_MAX = 200;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateRefusal(value: string | null | undefined): FieldError | null {
  const date = value?.trim();
  return !date || ISO_DATE_RE.test(date) ? null : { code: 'invalid_date' };
}

/** A stage's names: required and capped on add; on an edit, only a pair sent blank. */
function nameErrors(input: StageInput, mode: 'add' | 'update'): FieldErrors<BilingualNameField> {
  if (mode === 'add') return bilingualNameErrors(clean(input.nameEn), clean(input.nameAr), NAME_MAX);
  const bothSent = input.nameEn !== undefined && input.nameAr !== undefined;
  return bothSent && !clean(input.nameEn) && !clean(input.nameAr) ? { name: { code: 'name_required' } } : {};
}

/** Every broken rule, under its field. An edit checks only what it sends. */
export function stageFieldErrors(input: StageInput, mode: 'add' | 'update'): FieldErrors<StageField> {
  const progressSent = mode === 'add' || input.progressPct !== undefined;
  return {
    ...nameErrors(input, mode),
    ...collectFieldErrors<Exclude<StageField, BilingualNameField>>({
      progressPct: progressSent && normalizePercent(input.progressPct) === null ? PERCENT_REFUSAL : null,
      startDate: dateRefusal(input.startDate),
      endDate: dateRefusal(input.endDate),
    }),
  };
}
