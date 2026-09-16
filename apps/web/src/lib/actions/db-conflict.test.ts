import { describe, expect, it } from 'vitest';
import { isAmbiguousDbOutcome } from './db-failure';
import { isImmutabilityViolation, isUniqueViolation } from './db-conflict';

describe('isUniqueViolation', () => {
  it('recognises 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('is false for MT100, a plain Error, null and a non-string code', () => {
    expect(isUniqueViolation({ code: 'MT100' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });
});

describe('isImmutabilityViolation', () => {
  it('recognises MT100', () => {
    expect(isImmutabilityViolation({ code: 'MT100' })).toBe(true);
  });

  it('is false for 23505, a plain Error and null', () => {
    expect(isImmutabilityViolation({ code: '23505' })).toBe(false);
    expect(isImmutabilityViolation(new Error('boom'))).toBe(false);
    expect(isImmutabilityViolation(null)).toBe(false);
  });
});

describe('a refusal is never confused with an ambiguous outcome', () => {
  it('55P03 stays AMBIGUOUS and reaches neither classifier', () => {
    // The ordering inside mutationFailureCode depends on this: a lock timeout
    // must surface as `uncertain` so the caller HOLDS its idempotency key. If it
    // could also read as a named conflict, a retry would mint a fresh key.
    expect(isAmbiguousDbOutcome({ code: '55P03' })).toBe(true);
    expect(isUniqueViolation({ code: '55P03' })).toBe(false);
    expect(isImmutabilityViolation({ code: '55P03' })).toBe(false);
  });

  it('23505 and MT100 are NOT ambiguous', () => {
    expect(isAmbiguousDbOutcome({ code: '23505' })).toBe(false);
    expect(isAmbiguousDbOutcome({ code: 'MT100' })).toBe(false);
  });
});
