import { describe, expect, it } from 'vitest';
import { baseOf, digestOf, oneFactorAtATime, randomCases, readGolden, seededPicker } from './golden-cases';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const twelvePicks = (seed: number) => {
  const pick = seededPicker(seed);
  return Array.from({ length: 12 }, () => pick(DIGITS));
};

describe('seededPicker', () => {
  it('makes the same picks for the same seed, on every runtime', () => {
    expect(twelvePicks(1)).toEqual([6, 0, 5, 9, 9, 2, 6, 7, 4, 9, 4, 4]);
    expect(twelvePicks(2)).toEqual([7, 3, 2, 5, 8, 6, 4, 3, 7, 1, 7, 2]);
    expect(twelvePicks(1)).toEqual(twelvePicks(1));
  });
});

describe('digestOf', () => {
  it('is the first 16 hex characters of the SHA-256 of the UTF-8 text', () => {
    expect(digestOf('')).toBe('e3b0c44298fc1c14');
    expect(digestOf('abc')).toBe('ba7816bf8f01cfea');
    expect(digestOf('ميترا')).toBe('b13c7ebe339437fb');
  });

  it('sees one trailing space and one carriage return', () => {
    expect(digestOf('ميترا ')).toBe('259874d7fe4348b7');
    expect(digestOf('a\nb')).toBe('7e18f737311b2dc3');
    expect(digestOf('a\r\nb')).toBe('18745f36a05e2907');
  });
});

describe('oneFactorAtATime', () => {
  it('is the base, then the base with each other value of each pool, in key order', () => {
    const cases = oneFactorAtATime({ a: [1, 2, 3], b: ['x', 'y'] });
    expect(cases.map((c) => c.id)).toEqual(['ofat/base', 'ofat/a/1', 'ofat/a/2', 'ofat/b/1']);
    expect(cases.map((c) => c.choice)).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'x' },
      { a: 3, b: 'x' },
      { a: 1, b: 'y' },
    ]);
  });

  it('starts from the first value of every pool', () => {
    expect(baseOf({ a: [1, 2, 3], b: ['x', 'y'] })).toEqual({ a: 1, b: 'x' });
  });
});

describe('randomCases', () => {
  const pools = { a: [1, 2, 3], b: ['x', 'y'], c: [null, undefined, 0, ''] };

  it('returns `count` cases named rand/0 onwards, every value from its own pool', () => {
    const cases = randomCases(pools, 7, 40);
    expect(cases.map((c) => c.id)).toEqual(Array.from({ length: 40 }, (_unused, n) => `rand/${n}`));
    for (const { choice } of cases) {
      expect(Object.keys(choice)).toEqual(['a', 'b', 'c']);
      expect(pools.a).toContain(choice.a);
      expect(pools.b).toContain(choice.b);
      expect(pools.c).toContain(choice.c);
    }
  });

  it('returns the same cases for the same seed and other ones for another seed', () => {
    expect(randomCases(pools, 7, 40)).toEqual(randomCases(pools, 7, 40));
    expect(randomCases(pools, 7, 40)).not.toEqual(randomCases(pools, 8, 40));
  });
});

describe('readGolden', () => {
  it('reads a file as text with CRLF as LF', () => {
    const text = readGolden(new URL('./golden-cases.ts', import.meta.url));
    expect(text).not.toContain('\r');
    expect(text.startsWith('// TEST-ONLY')).toBe(true);
  });
});
