import { describe, expect, it } from 'vitest';
import { formatDate } from './date';
import { formatMoney } from './money';
import { formatNumber } from './number';

const ARABIC_INDIC = /[٠-٩۰-۹]/;

describe('formatNumber — Latin digits both locales', () => {
  it('groups thousands with 2 decimals in en', () => {
    const s = formatNumber(1234.5, 'en', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(s).toBe('1,234.50');
    expect(ARABIC_INDIC.test(s)).toBe(false);
  });

  it('groups thousands with 2 decimals in ar-EG (no Arabic-Indic digits)', () => {
    const s = formatNumber(1234.5, 'ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(s).toBe('1,234.50');
    expect(ARABIC_INDIC.test(s)).toBe(false);
  });

  it('accepts a numeric string (money stays string, never float)', () => {
    expect(
      formatNumber('1234.5000', 'en', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ).toBe('1,234.50');
  });
});

describe('formatMoney', () => {
  it('en -> EGP suffix', () => {
    expect(formatMoney(1234.5, 'en')).toBe('1,234.50 EGP');
  });
  it('ar -> ج.م suffix, Latin digits', () => {
    const s = formatMoney(1234.5, 'ar-EG');
    expect(s).toBe('1,234.50 ج.م');
    expect(ARABIC_INDIC.test(s)).toBe(false);
  });
});

describe('formatDate — DD/MM/YYYY, Africa/Cairo', () => {
  it('renders UTC in Cairo, same day', () => {
    expect(formatDate('2026-08-09T09:00:00Z', 'en')).toBe('09/08/2026');
    expect(formatDate('2026-08-09T09:00:00Z', 'ar-EG')).toBe('09/08/2026');
  });

  it('shifts the day when Cairo offset crosses midnight', () => {
    // 22:30Z + Cairo (+2/+3) -> next calendar day in Cairo.
    expect(formatDate('2026-08-09T22:30:00Z', 'en')).toBe('10/08/2026');
  });

  it('uses Latin digits in Arabic locale', () => {
    const s = formatDate('2026-08-09T09:00:00Z', 'ar-EG');
    expect(ARABIC_INDIC.test(s)).toBe(false);
  });
});
