import { describe, expect, it } from 'vitest';
import { cairoDate } from './visit-date';

/** The UTC offset Intl reports for Cairo at an instant, e.g. 'GMT+3'. */
function cairoOffset(instantIso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' }).formatToParts(
    new Date(instantIso),
  );
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

describe('cairoDate', () => {
  it('pins the offset these examples assume: summer time (UTC+3) on 23 Oct 2026', () => {
    expect(cairoOffset('2026-10-23T20:30:00Z')).toBe('GMT+3');
  });

  it('the plan examples (AC2)', () => {
    // 22:30 UTC is 01:30 the next morning in Cairo.
    expect(cairoDate('2026-10-23T22:30:00Z')).toBe('2026-10-24');
    // 20:30 UTC is 23:30 the same evening.
    expect(cairoDate('2026-10-23T20:30:00Z')).toBe('2026-10-23');
  });

  it('a check-in at 23:59 Cairo stays on its day; one at 00:01 is the next day', () => {
    expect(cairoDate('2026-10-23T20:59:00Z')).toBe('2026-10-23');
    expect(cairoDate('2026-10-23T21:01:00Z')).toBe('2026-10-24');
  });

  it('follows winter time (UTC+2) across midnight too', () => {
    expect(cairoOffset('2026-12-15T21:59:00Z')).toBe('GMT+2');
    expect(cairoDate('2026-12-15T21:59:00Z')).toBe('2026-12-15');
    expect(cairoDate('2026-12-15T22:01:00Z')).toBe('2026-12-16');
  });

  it('reads an instant written with an offset as that instant', () => {
    expect(cairoDate('2026-10-24T00:01:00+03:00')).toBe('2026-10-24');
    expect(cairoDate('2026-10-23T23:59:00+03:00')).toBe('2026-10-23');
  });

  it('crosses a month and a year end', () => {
    expect(cairoDate('2026-12-31T22:30:00Z')).toBe('2027-01-01');
  });

  it('refuses an instant it cannot read', () => {
    expect(() => cairoDate('not a date')).toThrow(RangeError);
    expect(() => cairoDate('')).toThrow(RangeError);
  });

  // F8 (S1 functional test): these were silently rolled over, guessed or read in the host's zone.
  it('refuses what is not a strict instant with an offset, rather than normalising it', () => {
    for (const value of ['2026-02-30T10:00:00Z', '1', '2026-10-23T23:30:00', '-000001-06-01T00:00:00Z']) {
      expect(() => cairoDate(value), value).toThrow(RangeError);
    }
  });

  it('always answers YYYY-MM-DD, and refuses an instant whose Cairo day leaves the 4-digit years', () => {
    expect(cairoDate('1000-06-01T00:00:00Z')).toBe('1000-06-01');
    expect(() => cairoDate('0999-06-01T00:00:00Z')).toThrow(RangeError);
    expect(() => cairoDate('0000-01-01T00:00:00Z')).toThrow(RangeError);
    expect(() => cairoDate('9999-12-31T23:00:00Z')).toThrow(RangeError);
  });
});
