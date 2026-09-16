import { describe, expect, it } from 'vitest';
import { readMoneyString } from '@/lib/money/read';
import {
  MAX_AMOUNT,
  chunk,
  normalizeText,
  withinMagnitude,
} from '@/lib/proposals/validation';
import {
  LINE_INSERT_CHUNK,
  MAX_LINES_PER_SECTION,
  MAX_SECTIONS,
  MAX_TOTAL_LINES,
} from './limits';

// The EXACT option set the proposal header and line validators use: an omitted
// field falls back to a caller-supplied value rather than being refused.
const readAmount = (value: string | null | undefined, blank = '0') =>
  readMoneyString(value, { blank });

// Audit finding 02: `proposals` had 12 source files and ZERO unit tests, leaning
// entirely on database suites that only run in CI. These are the pure validators
// that stand between a pasted string and a money column, so they are the part that
// most deserved proving in milliseconds rather than minutes.

describe('the line caps', () => {
  it('pins the numbers the builder guard and the server core must agree on', () => {
    // Four modules (proposals, contracts, variations, boqs) enforce these. They
    // are pinned here rather than in each module so a change is one visible diff
    // instead of four that can drift apart.
    expect(MAX_SECTIONS).toBe(100);
    expect(MAX_LINES_PER_SECTION).toBe(500);
    expect(MAX_TOTAL_LINES).toBe(2000);
  });

  it('keeps the insert batch clear of the bind-parameter ceiling', () => {
    // A line row carries ~15 columns; Postgres refuses past 65,535 parameters.
    expect(LINE_INSERT_CHUNK).toBe(500);
    expect(LINE_INSERT_CHUNK * 15).toBeLessThan(65_535);
  });

  it('allows a document that fills every section without hitting the total', () => {
    // MAX_TOTAL_LINES is the binding constraint, not MAX_SECTIONS x MAX_LINES:
    // the per-section cap alone would permit 50,000 lines.
    expect(MAX_SECTIONS * MAX_LINES_PER_SECTION).toBeGreaterThan(MAX_TOTAL_LINES);
  });
});

describe('a proposal money field', () => {
  it('falls back for absent input and rejects a malformed one', () => {
    expect(readAmount(null)).toBe('0');
    expect(readAmount(undefined)).toBe('0');
    expect(readAmount('')).toBe('0');
    expect(readAmount('   ')).toBe('0');
    expect(readAmount(null, '7')).toBe('7');
    expect(readAmount('abc')).toBeNull();
    expect(readAmount('1,000')).toBeNull();
    expect(readAmount('1e3')).toBeNull();
    expect(readAmount('0x10')).toBeNull();
  });

  it('rejects negatives — money here is never signed', () => {
    expect(readAmount('-1')).toBeNull();
    expect(readAmount('-0.5')).toBeNull();
  });

  it('clamps past the 4th decimal so the stored value cannot differ', () => {
    // The bug this closes: the app truncates past 4dp but numeric(18,4) ROUNDS, so
    // '2.99999' previewed as 2.9999 and came back from the database as 3.0000.
    expect(readAmount('2.99999')).toBe('2.9999');
    expect(readAmount('1.00005')).toBe('1.0000');
    // Anything already within scale is returned untouched.
    expect(readAmount('5')).toBe('5');
    expect(readAmount('5.1234')).toBe('5.1234');
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

describe('normalizeText', () => {
  it('trims, and collapses blank to null', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
    expect(normalizeText('   ')).toBeNull();
    expect(normalizeText('')).toBeNull();
    expect(normalizeText(null)).toBeNull();
    expect(normalizeText(undefined)).toBeNull();
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
