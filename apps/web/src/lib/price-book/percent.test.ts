import { describe, expect, it } from 'vitest';
import { BULK_PCT_MAX, BULK_PCT_MIN, bulkPercentError, isBulkPercent } from './percent';

describe('isBulkPercent', () => {
  it('accepts a plain decimal inside the range, signed or not', () => {
    for (const value of ['5', '-100', '1000', '-12.5', '0', '0.0001']) {
      expect(isBulkPercent(value)).toBe(true);
    }
  });

  it('refuses anything Number() would silently coerce', () => {
    // Each of these reads as a finite in-range number via Number() alone:
    // 100, 26, 5 and 0 respectively.
    for (const value of ['1e2', '0x1A', ' 5 ', '', '\n5', '5%', '+5']) {
      expect(isBulkPercent(value)).toBe(false);
    }
  });

  it('refuses a value outside the range, including just outside it', () => {
    for (const value of ['1001', '-100.1', '1000.0001']) {
      expect(isBulkPercent(value)).toBe(false);
    }
  });

  it('refuses a NUMBER, because only the checked string is safe to pass on', () => {
    expect(isBulkPercent(100)).toBe(false);
    expect(isBulkPercent(null)).toBe(false);
    expect(isBulkPercent(undefined)).toBe(false);
  });

  it('accepts exactly the documented bounds', () => {
    expect(isBulkPercent(String(BULK_PCT_MIN))).toBe(true);
    expect(isBulkPercent(String(BULK_PCT_MAX))).toBe(true);
  });
});

describe('bulkPercentError', () => {
  it('says what is wrong under the box: missing, not a number, or out of range', () => {
    expect(bulkPercentError('5')).toBeNull();
    expect(bulkPercentError('')).toEqual({ code: 'required' });
    expect(bulkPercentError('1e2')).toEqual({ code: 'not_a_number' });
    expect(bulkPercentError('1001')).toEqual({
      code: 'out_of_range',
      params: { min: BULK_PCT_MIN, max: BULK_PCT_MAX },
    });
  });
});
