import { describe, expect, it } from 'vitest';
import {
  mergeOnboardingMetadata,
  readOnboarding,
  withDismissedOrg,
} from './merge';

describe('readOnboarding', () => {
  it('returns {} on missing/garbage metadata', () => {
    expect(readOnboarding(undefined)).toEqual({});
    expect(readOnboarding({})).toEqual({});
    expect(readOnboarding({ onboarding: 'nope' })).toEqual({});
  });

  it('extracts known fields and ignores junk', () => {
    expect(
      readOnboarding({
        onboarding: {
          tourSeen: true,
          tourStep: 'clients',
          dismissedOrgs: ['a', 1, 'b'],
          junk: 5,
        },
      }),
    ).toEqual({
      tourSeen: true,
      tourStep: 'clients',
      tourCompletedAt: undefined,
      dismissedOrgs: ['a', 'b'],
    });
  });
});

describe('mergeOnboardingMetadata — preserves other keys', () => {
  it('keeps other top-level metadata AND other onboarding sub-keys', () => {
    const meta = {
      full_name: 'Nabil',
      locale_pref: 'ar-EG',
      onboarding: { tourSeen: false, dismissedOrgs: ['org-1'] },
    };
    const next = mergeOnboardingMetadata(meta, { tourSeen: true });
    expect(next.full_name).toBe('Nabil');
    expect(next.locale_pref).toBe('ar-EG');
    expect(next.onboarding).toEqual({
      tourSeen: true,
      dismissedOrgs: ['org-1'],
    });
    // original not mutated
    expect(meta.onboarding.tourSeen).toBe(false);
  });

  it('creates onboarding when metadata is empty', () => {
    expect(mergeOnboardingMetadata(undefined, { tourStep: 'x' })).toEqual({
      onboarding: { tourStep: 'x' },
    });
  });
});

describe('withDismissedOrg', () => {
  it('adds an org id, deduped', () => {
    expect(withDismissedOrg({}, 'a')).toEqual(['a']);
    expect(withDismissedOrg({ dismissedOrgs: ['a'] }, 'a')).toEqual(['a']);
    expect(withDismissedOrg({ dismissedOrgs: ['a'] }, 'b')).toEqual(['a', 'b']);
  });
});
