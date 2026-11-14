import { describe, expect, it } from 'vitest';
import { isImmutabilityViolation, isMembershipWriterViolation, isOwnerOnlyColumnViolation } from './db-conflict';

// MT150, the membership role-writer trigger's refusal (security batch 3, A5).
// Beside db-conflict.test.ts, which holds the other SQLSTATE readers.

/** The trigger's refusal as postgres.js throws it. */
const REFUSAL = { code: 'MT150', message: 'membership_write_refused', severity: 'ERROR' };

describe('isMembershipWriterViolation', () => {
  it('recognises MT150, thrown directly or wrapped by drizzle', () => {
    expect(isMembershipWriterViolation(REFUSAL)).toBe(true);
    const wrapped = Object.assign(new Error('Failed query: update "memberships" set "role" = $1'), { query: 'update', params: ['viewer'], cause: REFUSAL });
    expect(isMembershipWriterViolation(wrapped)).toBe(true);
    expect(isMembershipWriterViolation(new Error('outer', { cause: wrapped }))).toBe(true);
  });

  it('is false for the other reserved codes, a permission error, a plain Error and nothing', () => {
    for (const code of ['MT100', 'MT120', 'MT140', '42501', '23505', '55P03']) {
      expect(isMembershipWriterViolation({ code }), code).toBe(false);
    }
    expect(isMembershipWriterViolation(new Error('membership_write_refused'))).toBe(false);
    expect(isMembershipWriterViolation({ code: 150 })).toBe(false);
    expect(isMembershipWriterViolation(null)).toBe(false);
    expect(isMembershipWriterViolation(undefined)).toBe(false);
  });

  it('is not read as an immutability or an owner-only column refusal', () => {
    expect(isImmutabilityViolation(REFUSAL)).toBe(false);
    expect(isOwnerOnlyColumnViolation(REFUSAL)).toBe(false);
  });
});
