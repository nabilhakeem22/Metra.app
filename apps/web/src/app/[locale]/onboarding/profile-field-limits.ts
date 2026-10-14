// The onboarding fields: which profile refusals they show, and their length
// caps from the server's own table. PURE.
import { ORG_PROFILE_LIMITS } from '@/lib/org/profile-limits';
import type { OrgProfileField } from '@/lib/org/profile-field-rules';
import type { OnboardingProfileValues } from './onboarding-profile-fields';

export type OnboardingField = keyof OnboardingProfileValues;

/** The profile refusals this screen shows under a field (`name` under the Arabic
 *  name, the first); the tax number lives in Settings. */
export const ONBOARDING_FIELDS = ['name', 'nameAr', 'nameEn', 'city'] as const satisfies readonly OrgProfileField[];

export const FIELD_MAX_LENGTH: Readonly<Record<OnboardingField, number>> = {
  nameAr: ORG_PROFILE_LIMITS.name,
  nameEn: ORG_PROFILE_LIMITS.name,
  city: ORG_PROFILE_LIMITS.city,
};

/** The fields at (or, pasted past the input's cap, over) their limit: the form
 *  says so under each, because a paste that was cut short is not obvious. */
export function fieldsAtLimit(values: OnboardingProfileValues): OnboardingField[] {
  return (Object.keys(FIELD_MAX_LENGTH) as OnboardingField[]).filter(
    (field) => values[field].trim().length >= FIELD_MAX_LENGTH[field],
  );
}
