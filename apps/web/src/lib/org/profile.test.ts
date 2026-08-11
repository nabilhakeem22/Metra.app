import type { Organization } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { isProfileComplete } from './profile';

const org = (nameAr: string | null, nameEn: string | null, city: string | null) =>
  ({ nameAr, nameEn, city }) as unknown as Organization;

describe('isProfileComplete (regression lock)', () => {
  it('single-language (Arabic-only) firm with a city is complete', () => {
    expect(isProfileComplete(org('شركة ألف', null, 'القاهرة'))).toBe(true);
  });

  it('English-only firm with a city is complete', () => {
    expect(isProfileComplete(org(null, 'Alpha Fit-out', 'Cairo'))).toBe(true);
  });

  it('a name without a city is NOT complete', () => {
    expect(isProfileComplete(org(null, 'Alpha', null))).toBe(false);
  });

  it('a city without any name is NOT complete', () => {
    expect(isProfileComplete(org(null, null, 'Cairo'))).toBe(false);
  });

  it('whitespace-only values do not count', () => {
    expect(isProfileComplete(org('  ', 'X', '  '))).toBe(false);
    expect(isProfileComplete(null)).toBe(false);
  });
});
