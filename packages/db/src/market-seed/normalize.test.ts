import { describe, expect, it } from 'vitest';
import { normalizeArabic, toWesternDigits } from './normalize';

describe('normalize', () => {
  it('turns both Arabic-Indic digit sets into Western digits', () => {
    expect(toWesternDigits('٣٩٨٥٠ و ۱۲')).toBe('39850 و 12');
  });

  it('folds alef, ta marbuta and alef maqsura, and strips tatweel and diacritics', () => {
    expect(normalizeArabic('  أسمنت  إضافات آلي ـمادة  جِبسٌ مبنى  ')).toBe('اسمنت اضافات الي ماده جبس مبني');
  });
});
