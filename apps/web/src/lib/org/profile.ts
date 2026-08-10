import type { Organization } from '@metra/db';

type ProfileFields = Pick<Organization, 'nameAr' | 'nameEn' | 'city'>;

function has(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * "Complete company profile" is done when both names AND a city are set
 * (matches the getting-started checklist item).
 */
export function isProfileComplete(
  org: ProfileFields | null | undefined,
): boolean {
  if (!org) return false;
  return has(org.nameAr) && has(org.nameEn) && has(org.city);
}
