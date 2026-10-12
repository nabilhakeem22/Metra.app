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
});
