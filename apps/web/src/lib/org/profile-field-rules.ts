// The rules the studio profile's typed values must keep (onboarding and
// Settings). Pure and client-safe: the form runs them before sending, the
// server runs them again on what arrived. Every broken rule at once, under its
// own field; the either-or name under `name`.
import { hasFieldErrors, type FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { clean } from '@/lib/validation/text';
import { bilingualNameErrors, boundedText, type BilingualNameField } from '@/lib/validation/text-field-rules';
import { ORG_PROFILE_LIMITS } from './profile-limits';

/** Every path a profile refusal can name; `name` is the Arabic/English pair. */
export const ORG_PROFILE_FIELDS = ['name', 'nameEn', 'nameAr', 'city', 'taxRegistrationNumber'] as const;

export type OrgProfileField = (typeof ORG_PROFILE_FIELDS)[number];

/** The profile's text, as onboarding and Settings send it. */
export interface OrgProfileText {
  nameEn?: string | null;
  nameAr?: string | null;
  city?: string | null;
  taxRegistrationNumber?: string | null;
}

export interface OrgProfileValues {
  nameEn: string | null;
  nameAr: string | null;
  city: string | null;
  taxRegistrationNumber: string | null;
}

export type OrgProfileRead =
  | { ok: true; values: OrgProfileValues }
  | { ok: false; errors: FieldErrors<OrgProfileField> };

/** Read the profile's text, or say under each field what is wrong. */
export function readOrgProfile(input: OrgProfileText): OrgProfileRead {
  const values: OrgProfileValues = {
    nameEn: clean(input.nameEn),
    nameAr: clean(input.nameAr),
    city: clean(input.city),
    taxRegistrationNumber: clean(input.taxRegistrationNumber),
  };
  const errors: FieldErrors<OrgProfileField> = {
    ...bilingualNameErrors(values.nameEn, values.nameAr, ORG_PROFILE_LIMITS.name),
    ...collectFieldErrors<Exclude<OrgProfileField, BilingualNameField>>({
      city: boundedText(values.city, ORG_PROFILE_LIMITS.city),
      taxRegistrationNumber: boundedText(values.taxRegistrationNumber, ORG_PROFILE_LIMITS.taxReg),
    }),
  };
  return hasFieldErrors(errors) ? { ok: false, errors } : { ok: true, values };
}

/** The form's pre-check: the same rules, as the refusals under each field. */
export function orgProfileFieldErrors(input: OrgProfileText): FieldErrors<OrgProfileField> {
  const read = readOrgProfile(input);
  return read.ok ? {} : read.errors;
}
