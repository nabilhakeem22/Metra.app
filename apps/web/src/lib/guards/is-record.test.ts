import { describe, expect, it } from 'vitest';
import { isRecord } from './is-record';

// The guard that stands between an untyped JSONB transition payload and the first
// property read on it. Its two former copies were identical; this pins the
// behaviour they shared, including the parts that look like oversights but are not.

describe('isRecord', () => {
  it('accepts a plain object, which is what a JSONB payload deserialises to', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ designFee: '1000' })).toBe(true);
  });

  it('rejects null — typeof null is "object" and indexing it throws', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('rejects every non-object the payload column can hold', () => {
    for (const value of [undefined, 'a string', 42, true, Symbol('x')]) {
      expect(isRecord(value)).toBe(false);
    }
  });

  it('accepts arrays and Dates, deliberately', () => {
    // Callers immediately read a NAMED property, which is undefined on both and
    // then fails its own shape check. Excluding them would add an unobservable
    // branch, so the guard stays as narrow as the call sites actually need.
    expect(isRecord([])).toBe(true);
    expect(isRecord(new Date())).toBe(true);
  });
});
