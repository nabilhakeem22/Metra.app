import { describe, expect, it } from 'vitest';
import { validIsoDate } from './iso-date';

// Moved verbatim from lib/proposals/validation.test.ts when the function left the
// proposals module. Contracts and proposals both date documents; neither owns the
// calendar.

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
