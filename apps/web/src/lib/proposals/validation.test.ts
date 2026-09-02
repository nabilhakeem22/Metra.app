import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT,
  chunk,
  normalizeMoney,
  normalizeText,
  pctInRange,
  validIsoDate,
  withinMagnitude,
} from './validation';

// Audit finding 02: `proposals` had 12 source files and ZERO unit tests, leaning
// entirely on database suites that only run in CI. These are the pure validators
// that stand between a pasted string and a money column, so they are the part that
// most deserved proving in milliseconds rather than minutes.

describe('normalizeMoney', () => {
  it('falls back for absent input and rejects a malformed one', () => {
    expect(normalizeMoney(null)).toBe('0');
    expect(normalizeMoney(undefined)).toBe('0');
    expect(normalizeMoney('')).toBe('0');
    expect(normalizeMoney('   ')).toBe('0');
    expect(normalizeMoney(null, '7')).toBe('7');
    expect(normalizeMoney('abc')).toBeNull();
    expect(normalizeMoney('1,000')).toBeNull();
    expect(normalizeMoney('1e3')).toBeNull();
    expect(normalizeMoney('0x10')).toBeNull();
  });

  it('rejects negatives — money here is never signed', () => {
    expect(normalizeMoney('-1')).toBeNull();
    expect(normalizeMoney('-0.5')).toBeNull();
  });

  it('clamps past the 4th decimal so the stored value cannot differ', () => {
    // The bug this closes: the app truncates past 4dp but numeric(18,4) ROUNDS, so
    // '2.99999' previewed as 2.9999 and came back from the database as 3.0000.
    expect(normalizeMoney('2.99999')).toBe('2.9999');
    expect(normalizeMoney('1.00005')).toBe('1.0000');
    // Anything already within scale is returned untouched.
    expect(normalizeMoney('5')).toBe('5');
    expect(normalizeMoney('5.1234')).toBe('5.1234');
  });
});

describe('withinMagnitude', () => {
  it('accepts up to the cap and rejects beyond it', () => {
    expect(withinMagnitude('0')).toBe(true);
    expect(withinMagnitude(String(MAX_AMOUNT))).toBe(true);
    expect(withinMagnitude(String(MAX_AMOUNT + 1))).toBe(false);
    expect(withinMagnitude('99999999999999999999')).toBe(false);
  });

  it('rejects what bare Number() would have accepted', () => {
    // Number('0x10') is 16 and Number('') is 0 — both would have passed the cap.
    // Unreachable today because every call site normalizes first; pinned so that
    // stays a property of the function rather than of its callers.
    for (const junk of ['0x10', '1e2', '0b11', '', '   ', 'abc']) {
      expect(withinMagnitude(junk)).toBe(false);
    }
  });

  it('still accepts surrounding whitespace, like every other normalizer here', () => {
    // Trimming is deliberate and shared with normalizeMoney: a newline-prefixed
    // '5' is a valid 5, not junk. Pinned so a future tightening does not silently
    // start rejecting pasted input.
    expect(withinMagnitude('\n5')).toBe(true);
    expect(withinMagnitude('  12.5  ')).toBe(true);
  });
});

describe('pctInRange', () => {
  it('accepts 0 through 100 inclusive', () => {
    for (const value of ['0', '0.5', '17.25', '99.9999', '100']) {
      expect(pctInRange(value)).toBe(true);
    }
  });

  it('rejects out-of-range and negative', () => {
    for (const value of ['100.0001', '101', '-1', '-0.5']) {
      expect(pctInRange(value)).toBe(false);
    }
  });

  it('rejects the shapes bare Number() coerced into a valid percentage', () => {
    // '0x10' read as 16%, '1e2' as 100%, and '' as 0% — a silent discount.
    for (const junk of ['0x10', '1e2', '0b11', '', '   ', 'abc', 'Infinity']) {
      expect(pctInRange(junk)).toBe(false);
    }
  });
});

describe('normalizeText', () => {
  it('trims, and collapses blank to null', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
    expect(normalizeText('   ')).toBeNull();
    expect(normalizeText('')).toBeNull();
    expect(normalizeText(null)).toBeNull();
    expect(normalizeText(undefined)).toBeNull();
  });
});

describe('validIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(validIsoDate('2026-02-28')).toBe(true);
    expect(validIsoDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects a date that does not exist, even though it parses', () => {
    // `new Date('2026-02-30')` rolls over to 2026-03-02 rather than throwing — the
    // round-trip comparison is what catches it.
    expect(validIsoDate('2026-02-30')).toBe(false);
    expect(validIsoDate('2023-02-29')).toBe(false); // not a leap year
    expect(validIsoDate('2026-13-01')).toBe(false);
    expect(validIsoDate('2026-00-10')).toBe(false);
  });

  it('rejects anything not in plain ISO form', () => {
    for (const value of ['2026-2-8', '26-02-08', '2026/02/08', '', 'today']) {
      expect(validIsoDate(value)).toBe(false);
    }
  });
});

describe('chunk', () => {
  it('splits evenly and keeps the remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it('handles an empty list and a size larger than the list', () => {
    expect(chunk([], 10)).toEqual([]);
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});
