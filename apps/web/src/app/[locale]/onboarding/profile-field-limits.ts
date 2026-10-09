// The onboarding fields' length caps, from the server's own table. PURE.
import { ORG_PROFILE_LIMITS } from '@/lib/org/profile-limits';
import type { OnboardingProfileValues } from './onboarding-profile-fields';

export type OnboardingField = keyof OnboardingProfileValues;

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

/** The fields the server would refuse: the form never sends them. */
export function fieldsOverLimit(values: OnboardingProfileValues): OnboardingField[] {
  return (Object.keys(FIELD_MAX_LENGTH) as OnboardingField[]).filter(
    (field) => values[field].trim().length > FIELD_MAX_LENGTH[field],
  );
}
