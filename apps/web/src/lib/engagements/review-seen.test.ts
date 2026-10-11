import { describe, expect, it } from 'vitest';
import { bandSeenOf, parseBandSeen, parseReviewSeen, reviewSeenOf } from './review-seen';

// Round D: what the client saw is the two ISSUANCE instants, carried
// byte-identical (the database compares them to the microsecond).

const ROM = '2026-10-01T09:00:00.123456+00:00';
const RENDERS = '2026-10-02T09:00:00.654321+03:00';

describe('reviewSeenOf', () => {
  it('reads the band issuance and the render round off the page, unchanged', () => {
    const delivery = { rom: { low: '900000.0000', high: '1200000.0000', issuedAt: ROM }, rendersIssuedAt: RENDERS };
    expect(reviewSeenOf(delivery)).toEqual({ romIssuedAt: ROM, rendersIssuedAt: RENDERS });
    expect(bandSeenOf(delivery)).toBe(ROM);
  });

  it('no band, no band issuance; no round, no round issuance', () => {
    expect(reviewSeenOf({ rom: null, rendersIssuedAt: null })).toEqual({ romIssuedAt: null, rendersIssuedAt: null });
  });
});

describe('parsing what a browser sent', () => {
  it('accepts both keys, each a stamp or null', () => {
    expect(parseReviewSeen({ romIssuedAt: ROM, rendersIssuedAt: RENDERS })).toEqual({ romIssuedAt: ROM, rendersIssuedAt: RENDERS });
    expect(parseReviewSeen({ romIssuedAt: null, rendersIssuedAt: null })).toEqual({ romIssuedAt: null, rendersIssuedAt: null });
  });

  it.each([
    ['the pre-Round D shape', { band: '1..2', round: 'x|a,b' }],
    ['a missing key', { romIssuedAt: ROM }],
    ['a key that is not a stamp', { romIssuedAt: ROM, rendersIssuedAt: 'yesterday' }],
    ['a number', { romIssuedAt: 1, rendersIssuedAt: null }],
    ['an array', [ROM, RENDERS]],
    ['null', null],
    ['a string', ROM],
  ])('refuses %s', (_label, raw) => {
    expect(parseReviewSeen(raw)).toBeNull();
  });

  it('the budget card sends one stamp, or null', () => {
    expect(parseBandSeen(ROM)).toBe(ROM);
    expect(parseBandSeen(null)).toBeNull();
    expect(parseBandSeen('900000.0000..1200000.0000')).toBeUndefined();
    expect(parseBandSeen(5)).toBeUndefined();
  });
});
