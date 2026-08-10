import type { Organization } from '@metra/db';

type ProfileFields = Pick<Organization, 'nameAr' | 'nameEn' | 'city'>;

function has(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * "Complete company profile" is done when at least ONE name AND a city are set.
 * The onboarding/settings forms only require one name (city optional), so a
 * single-language (e.g. Arabic-only) firm can complete this by adding a city.
 */
export function isProfileComplete(
  org: ProfileFields | null | undefined,
): boolean {
  if (!org) return false;
  return (has(org.nameAr) || has(org.nameEn)) && has(org.city);
}
