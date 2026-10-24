import { describe, expect, it } from 'vitest';
import { parseIsoInstant } from './iso-instant';

describe('parseIsoInstant', () => {
  it('reads Z and explicit offsets as the instant they name', () => {
    expect(parseIsoInstant('2026-10-23T07:00:00Z').toISOString()).toBe('2026-10-23T07:00:00.000Z');
    expect(parseIsoInstant('2026-10-23T10:00:00+03:00').toISOString()).toBe('2026-10-23T07:00:00.000Z');
    expect(parseIsoInstant('2026-10-23T02:30:00-04:30').toISOString()).toBe('2026-10-23T07:00:00.000Z');
  });

  it('takes the forms a phone writes: toISOString, no seconds, a short fraction', () => {
    expect(parseIsoInstant('2026-10-23T07:00:00.123Z').getTime()).toBe(Date.UTC(2026, 9, 23, 7, 0, 0, 123));
    expect(parseIsoInstant('2026-10-23T07:00Z').getTime()).toBe(Date.UTC(2026, 9, 23, 7));
    expect(parseIsoInstant('2026-10-23T07:00:00.5Z').getTime()).toBe(Date.UTC(2026, 9, 23, 7, 0, 0, 500));
  });

  it('accepts the leap day of a leap year only', () => {
    expect(parseIsoInstant('2028-02-29T10:00:00Z').getTime()).toBe(Date.UTC(2028, 1, 29, 10));
    expect(parseIsoInstant('2000-02-29T10:00:00Z').getTime()).toBe(Date.UTC(2000, 1, 29, 10));
    expect(() => parseIsoInstant('2026-02-29T10:00:00Z')).toThrow(RangeError);
    expect(() => parseIsoInstant('2100-02-29T10:00:00Z')).toThrow(RangeError);
  });

  it('keeps the years 0 to 99 as written, not as 1900 to 1999', () => {
    expect(parseIsoInstant('0050-06-01T00:00:00Z').getUTCFullYear()).toBe(50);
  });

  // F8 (S1 functional test): each of these was silently read or rolled over by `new Date()`.
  it.each([
    ['an impossible date', '2026-02-30T10:00:00Z'],
    ['a bare number', '1'],
    ['no offset (host-time-zone dependent)', '2026-10-23T23:30:00'],
    ['a date without a time', '2026-10-23'],
    ['an expanded year', '-000001-06-01T00:00:00Z'],
    ['a 5-digit year', '+10000-01-01T00:00:00Z'],
    ['month 13', '2026-13-01T10:00:00Z'],
    ['day 0', '2026-10-00T10:00:00Z'],
    ['hour 24', '2026-10-23T24:00:00Z'],
    ['minute 60', '2026-10-23T10:60:00Z'],
    ['a leap second', '2026-12-31T23:59:60Z'],
    ['an offset without its colon', '2026-10-23T10:00:00+0300'],
    ['an offset minute over 59', '2026-10-23T10:00:00+03:60'],
    ['a space for the T', '2026-10-23 10:00:00Z'],
    ['a lower-case z', '2026-10-23T10:00:00z'],
    ['a 4-digit fraction', '2026-10-23T10:00:00.1234Z'],
    ['words', 'nope'],
    ['nothing', ''],
    ['trailing text', '2026-10-23T10:00:00Z junk'],
  ])('refuses %s: %s', (_case, value) => {
    expect(() => parseIsoInstant(value)).toThrow(RangeError);
  });
});
