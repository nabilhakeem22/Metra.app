import { describe, expect, it } from 'vitest';
import { latinDigits } from './latin-digits';

describe('latinDigits', () => {
  it('folds Arabic-Indic and Extended Arabic-Indic digits, and nothing else', () => {
    expect(latinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(latinDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(latinDigits('رمز ٤٢-ab 7')).toBe('رمز 42-ab 7');
    expect(latinDigits('')).toBe('');
  });
});
