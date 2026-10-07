import { describe, expect, it } from 'vitest';
import { formatDate, formatTime } from './date';
import { formatDocNumber } from './doc-number';
import { formatMoney, formatMoneyAmount, moneySymbol } from './money';
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

describe('formatMoneyAmount + moneySymbol — the figure and its label, apart', () => {
  it('prints the formatMoney figure without the label, Latin digits', () => {
    expect(formatMoneyAmount('900000.0000', 'en')).toBe('900,000.00');
    const s = formatMoneyAmount('900000.0000', 'ar-EG');
    expect(s).toBe('900,000.00');
    expect(ARABIC_INDIC.test(s)).toBe(false);
  });

  it('recomposes to exactly what formatMoney prints', () => {
    for (const locale of ['en', 'ar-EG']) {
      expect(`${formatMoneyAmount('1234.5', locale)} ${moneySymbol(locale)}`).toBe(
        formatMoney('1234.5', locale),
      );
    }
  });

  it('labels EGP in English and ج.م in Arabic', () => {
    expect(moneySymbol('en')).toBe('EGP');
    expect(moneySymbol('ar-EG')).toBe('ج.م');
  });

  it('trimWholeDecimals: a whole amount prints with no fraction', () => {
    const trim = { trimWholeDecimals: true };
    expect(formatMoney('120000.0000', 'en', trim)).toBe('120,000 EGP');
    expect(formatMoney('120000.0000', 'ar-EG', trim)).toBe('120,000 ج.م');
    expect(formatMoneyAmount('900000', 'en', trim)).toBe('900,000');
    // Whole at 2 decimals: it rounds the way the 2-decimal figure would.
    expect(formatMoneyAmount('20000.0040', 'en', trim)).toBe('20,000');
    expect(formatMoneyAmount('20000.9960', 'en', trim)).toBe('20,001');
    expect(formatMoneyAmount('0', 'en', trim)).toBe('0');
  });

  it('trimWholeDecimals: any other amount keeps exactly 2 decimals', () => {
    const trim = { trimWholeDecimals: true };
    expect(formatMoney('20000.5000', 'en', trim)).toBe('20,000.50 EGP');
    expect(formatMoneyAmount('28000.0500', 'ar-EG', trim)).toBe('28,000.05');
    expect(formatMoneyAmount(null, 'en', trim)).toBe('');
  });

  it('without the option a whole amount is unchanged: 2 decimals', () => {
    expect(formatMoney('120000.0000', 'en')).toBe('120,000.00 EGP');
    expect(formatMoneyAmount('900000', 'ar-EG')).toBe('900,000.00');
  });

  it('returns "" for absent/invalid input, and normalizes negative zero', () => {
    expect(formatMoneyAmount(null, 'en')).toBe('');
    expect(formatMoneyAmount('  ', 'en')).toBe('');
    expect(formatMoneyAmount('abc', 'ar-EG')).toBe('');
    expect(formatMoneyAmount('-0', 'en')).toBe('0.00');
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

describe('formatTime: HH:mm, Africa/Cairo', () => {
  it('renders 24-hour Cairo time with Latin digits in both locales', () => {
    // August: Cairo is UTC+3 (summer time).
    expect(formatTime('2026-08-09T11:02:00Z', 'en')).toBe('14:02');
    const arabic = formatTime('2026-08-09T11:02:00Z', 'ar-EG');
    expect(ARABIC_INDIC.test(arabic)).toBe(false);
    expect(arabic).toContain('14');
    expect(arabic).toContain('02');
  });

  it('renders nothing for an invalid instant', () => {
    expect(formatTime('not a date', 'en')).toBe('');
  });
});

describe('formatDocNumber — BQ', () => {
  it('pads a BOQ number to the same shape as a proposal or contract number', () => {
    expect(formatDocNumber('BQ', 7, 2026)).toBe('BQ-2026-0007');
    expect(formatDocNumber('BQ', 1284, 2026)).toBe('BQ-2026-1284');
  });
});
