import { describe, expect, it } from 'vitest';
import { cachedDateTimeFormat, cachedNumberFormat, cachedRelativeTimeFormat } from './intl-cache';
import { formatNumber } from './number';

// Identity and bounds of the formatter cache (Round E, AC W5 and W7). That the
// cached formatters print exactly what fresh ones do is intl-cache-output.test.ts.

const FORMATTERS_PER_KIND = 64;

describe('the Intl formatter cache', () => {
  it('answers the same instance for the same locale and options', () => {
    expect(cachedNumberFormat('en', { maximumFractionDigits: 3 })).toBe(
      cachedNumberFormat('en', { maximumFractionDigits: 3 }),
    );
    expect(cachedDateTimeFormat('ar-EG', { timeZone: 'UTC', year: 'numeric' })).toBe(
      cachedDateTimeFormat('ar-EG', { timeZone: 'UTC', year: 'numeric' }),
    );
    expect(cachedRelativeTimeFormat('en', { numeric: 'auto' })).toBe(cachedRelativeTimeFormat('en', { numeric: 'auto' }));
    expect(cachedNumberFormat('en')).toBe(cachedNumberFormat('en', undefined));
  });

  it('answers another instance for other options or another locale', () => {
    const base = cachedNumberFormat('en', { maximumFractionDigits: 1 });
    expect(cachedNumberFormat('en', { maximumFractionDigits: 2 })).not.toBe(base);
    expect(cachedNumberFormat('ar-EG', { maximumFractionDigits: 1 })).not.toBe(base);
    expect(cachedRelativeTimeFormat('en', { numeric: 'always' })).not.toBe(cachedRelativeTimeFormat('en', { numeric: 'auto' }));
  });

  it('keeps one Map per kind: a number key does not answer a date formatter', () => {
    const date = cachedDateTimeFormat('en', { timeZone: 'UTC' });
    expect(date).toBeInstanceOf(Intl.DateTimeFormat);
    expect(cachedNumberFormat('en', { timeZone: 'UTC' } as Intl.NumberFormatOptions)).toBeInstanceOf(Intl.NumberFormat);
  });

  it('past its bound it builds a fresh formatter on every call, and each still formats right', () => {
    const kept = cachedDateTimeFormat('en', { timeZone: 'UTC', year: '2-digit' });
    // 64 distinct keys fill the date kind whatever it already held. Intl ignores
    // a property it does not know, so `filler` only makes each key distinct.
    for (let filler = 0; filler < FORMATTERS_PER_KIND; filler += 1) {
      cachedDateTimeFormat('en', { timeZone: 'UTC', filler } as Intl.DateTimeFormatOptions);
    }
    // Never evicted: what was cached before the bound is still the one answered.
    expect(cachedDateTimeFormat('en', { timeZone: 'UTC', year: '2-digit' })).toBe(kept);
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric', month: 'long' };
    const first = cachedDateTimeFormat('en', options);
    const second = cachedDateTimeFormat('en', options);
    expect(first).not.toBe(second);
    const instant = Date.UTC(2026, 9, 12);
    expect(first.format(instant)).toBe('October 2026');
    expect(second.format(instant)).toBe('October 2026');
  });

  it('an invalid locale throws RangeError, as before, and is not cached', () => {
    expect(() => formatNumber(1, 'not a locale!!')).toThrow(RangeError);
    expect(() => formatNumber(1, 'not a locale!!')).toThrow(RangeError);
    expect(() => cachedNumberFormat('en', { style: 'currency' })).toThrow(TypeError);
  });

  describe('options a text key could confuse (Round E F3)', () => {
    it('NaN, Infinity and null are not one key: each behaves as a fresh constructor', () => {
      expect(cachedNumberFormat('en', { maximumFractionDigits: null as never }).format(1.5)).toBe(
        new Intl.NumberFormat('en', { maximumFractionDigits: null as never }).format(1.5),
      );
      expect(() => cachedNumberFormat('en', { maximumFractionDigits: Number.NaN })).toThrow(RangeError);
      expect(() => cachedNumberFormat('en', { maximumFractionDigits: Number.POSITIVE_INFINITY })).toThrow(RangeError);
      expect(() => cachedNumberFormat('en', { maximumFractionDigits: Number.NaN })).toThrow(RangeError);
    });

    it('an inherited option is honoured (built uncached), never answered from a plain key', () => {
      cachedNumberFormat('en-u-nu-latn', {});
      const inherited = Object.create({ style: 'percent' }) as Intl.NumberFormatOptions;
      expect(cachedNumberFormat('en-u-nu-latn', inherited).format(0.5)).toBe('50%');
      expect(cachedNumberFormat('en-u-nu-latn', inherited)).not.toBe(cachedNumberFormat('en-u-nu-latn', inherited));
    });

    it('a non-enumerable option or a getter is honoured, built uncached', () => {
      const hidden = Object.defineProperty({}, 'style', { value: 'percent', enumerable: false }) as Intl.NumberFormatOptions;
      expect(cachedNumberFormat('en', hidden).format(0.5)).toBe('50%');
      let reads = 0;
      const getter = Object.defineProperty({}, 'maximumFractionDigits', { enumerable: true, get: () => (reads += 1) });
      expect(cachedNumberFormat('en', getter as Intl.NumberFormatOptions)).not.toBe(cachedNumberFormat('en', getter as Intl.NumberFormatOptions));
    });

    it('an options object changed after use is keyed by its new values; a frozen one keeps its key', () => {
      const options: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };
      expect(cachedNumberFormat('en', options).format(1.23456)).toBe('1.2');
      options.maximumFractionDigits = 3;
      expect(cachedNumberFormat('en', options).format(1.23456)).toBe('1.235');
      const frozen = Object.freeze({ maximumFractionDigits: 2 });
      expect(cachedNumberFormat('en', frozen)).toBe(cachedNumberFormat('en', { maximumFractionDigits: 2 }));
    });

    it('the same plain options in another key order are one formatter; a string "1" and the number 1 are two', () => {
      expect(cachedNumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 3 })).toBe(
        cachedNumberFormat('en', { maximumFractionDigits: 3, minimumFractionDigits: 1 }),
      );
      expect(cachedNumberFormat('en', { maximumFractionDigits: '1' as never })).not.toBe(cachedNumberFormat('en', { maximumFractionDigits: 1 }));
    });
  });
});
