import { describe, expect, it } from 'vitest';
import { formatDate } from './date';
import { formatMoney } from './money';
import { formatNumber, formatPercent, formatQuantity } from './number';

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

  it('accepts a numeric string', () => {
    expect(formatMoney('2300.0000', 'en')).toBe('2,300.00 EGP');
  });

  it('normalizes negative zero (no "-0.00")', () => {
    expect(formatMoney(-0, 'en')).toBe('0.00 EGP');
    expect(formatMoney('-0', 'en')).toBe('0.00 EGP');
    expect(formatMoney('-0.00', 'ar-EG')).toBe('0.00 ج.م');
  });

  it('returns "" for absent/invalid input (no fabricated 0.00, no bare " EGP")', () => {
    expect(formatMoney('', 'en')).toBe('');
    expect(formatMoney('   ', 'ar-EG')).toBe('');
    expect(formatMoney(null, 'en')).toBe('');
    expect(formatMoney(undefined, 'ar-EG')).toBe('');
    expect(formatMoney('not-a-number', 'en')).toBe('');
    expect(formatMoney(Number.NaN, 'en')).toBe('');
  });
});

describe('formatPercent — exactly 2 fraction digits + %', () => {
  it('renders a scale-4 string as 2 decimals + % (en)', () => {
    expect(formatPercent('14.0000', 'en')).toBe('14.00%');
  });
  it('renders a scale-4 string as 2 decimals + %, Latin digits (ar-EG)', () => {
    const s = formatPercent('14.0000', 'ar-EG');
    expect(s).toBe('14.00%');
    expect(ARABIC_INDIC.test(s)).toBe(false);
  });
  it('rounds a longer fraction to 2 places', () => {
    expect(formatPercent(66.6666, 'en')).toBe('66.67%');
    expect(formatPercent('12.3456', 'en')).toBe('12.35%');
  });
  it('accepts a plain number', () => {
    expect(formatPercent(50, 'en')).toBe('50.00%');
  });
  it('normalizes negative zero (no "-0.00%")', () => {
    expect(formatPercent(-0, 'en')).toBe('0.00%');
    expect(formatPercent('-0', 'en')).toBe('0.00%');
  });
  it('returns "" for absent/blank/NaN input (no "NaN%")', () => {
    expect(formatPercent('', 'en')).toBe('');
    expect(formatPercent('   ', 'ar-EG')).toBe('');
    expect(formatPercent(null, 'en')).toBe('');
    expect(formatPercent(undefined, 'en')).toBe('');
    expect(formatPercent('not-a-number', 'en')).toBe('');
    expect(formatPercent(Number.NaN, 'en')).toBe('');
  });
});

describe('formatQuantity — up to 2 fraction digits, no forced zeros', () => {
  it('trims a scale-4 integer qty to a bare integer', () => {
    expect(formatQuantity('1.0000', 'en')).toBe('1');
  });
  it('keeps a real fractional qty', () => {
    expect(formatQuantity('1.5000', 'en')).toBe('1.5');
    expect(formatQuantity('2.25', 'en')).toBe('2.25');
  });
  it('uses Latin digits in Arabic locale', () => {
    const s = formatQuantity('1234.5000', 'ar-EG');
    expect(ARABIC_INDIC.test(s)).toBe(false);
  });
  it('returns "" for absent/blank/NaN input', () => {
    expect(formatQuantity('', 'en')).toBe('');
    expect(formatQuantity(null, 'en')).toBe('');
    expect(formatQuantity(undefined, 'en')).toBe('');
    expect(formatQuantity(Number.NaN, 'en')).toBe('');
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
