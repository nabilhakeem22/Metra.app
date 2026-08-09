import { describe, expect, it } from 'vitest';
import { pickLocale } from './pick-locale';

const row = { nameAr: 'شركة ألف', nameEn: 'Org A' };

describe('pickLocale', () => {
  it('returns the requested locale when present', () => {
    expect(pickLocale(row, 'name', 'ar-EG')).toEqual({
      value: 'شركة ألف',
      isFallback: false,
    });
    expect(pickLocale(row, 'name', 'en')).toEqual({
      value: 'Org A',
      isFallback: false,
    });
  });

  it('falls back to the other language, marked as fallback', () => {
    expect(pickLocale({ nameAr: null, nameEn: 'Org A' }, 'name', 'ar-EG')).toEqual(
      { value: 'Org A', isFallback: true },
    );
    expect(pickLocale({ nameAr: 'شركة', nameEn: '' }, 'name', 'en')).toEqual({
      value: 'شركة',
      isFallback: true,
    });
  });

  it('never throws on empty/absent rows', () => {
    expect(pickLocale(null, 'name', 'en')).toEqual({
      value: '',
      isFallback: false,
    });
    expect(pickLocale({ nameAr: '', nameEn: '' }, 'name', 'ar-EG')).toEqual({
      value: '',
      isFallback: false,
    });
  });
});
