import { describe, expect, it } from 'vitest';
import { isAmbiguousDbOutcome } from './db-failure';

// postgres.js copies the server's SQLSTATE onto `error.code` as a string.
const pgError = (code: string) => Object.assign(new Error(code), { code });

describe('isAmbiguousDbOutcome', () => {
  it('is true for a lock timeout — the lock holder may be the attempt being retried', () => {
    expect(isAmbiguousDbOutcome(pgError('55P03'))).toBe(true);
  });

  it('is true for a cancelled statement and for every connection exception', () => {
    expect(isAmbiguousDbOutcome(pgError('57014'))).toBe(true);
    expect(isAmbiguousDbOutcome(pgError('08000'))).toBe(true);
    expect(isAmbiguousDbOutcome(pgError('08006'))).toBe(true);
    expect(isAmbiguousDbOutcome(pgError('08P01'))).toBe(true);
  });

  it('is false for errors that definitively committed nothing', () => {
    expect(isAmbiguousDbOutcome(pgError('23505'))).toBe(false); // unique violation
    expect(isAmbiguousDbOutcome(pgError('23514'))).toBe(false); // check violation
    expect(isAmbiguousDbOutcome(pgError('42703'))).toBe(false); // undefined column
    // '08' as a prefix of a longer non-class-08 code cannot exist, but a code
    // that merely CONTAINS 08 must not match.
    expect(isAmbiguousDbOutcome(pgError('P0801'))).toBe(false);
  });

  it('is false for anything that is not a Postgres error', () => {
    expect(isAmbiguousDbOutcome(new Error('boom'))).toBe(false);
    expect(isAmbiguousDbOutcome(null)).toBe(false);
    expect(isAmbiguousDbOutcome(undefined)).toBe(false);
    expect(isAmbiguousDbOutcome('55P03')).toBe(false);
    expect(isAmbiguousDbOutcome({ code: 55103 })).toBe(false);
  });
});
