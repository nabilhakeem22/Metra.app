import { describe, expect, it } from 'vitest';
import { decimalExceeds, percentChange } from './market-percent';

describe('percentChange', () => {
  it('computes to one decimal place', () => {
    expect(percentChange('38200', '39850')).toBe('4.3');
    expect(percentChange('38500', '51000')).toBe('32.5');
    expect(percentChange('4429', '4296')).toBe('-3.0');
    expect(percentChange('26.12', '30.455')).toBe('16.6');
  });

  it('rounds half away from zero', () => {
    expect(percentChange('1000', '1000.5')).toBe('0.1');
    expect(percentChange('1000', '999.5')).toBe('-0.1');
    expect(percentChange('1000', '1000.4')).toBe('0.0');
  });

  it('answers null without a base or a value', () => {
    expect(percentChange('0', '5')).toBeNull();
    expect(percentChange(null, '5')).toBeNull();
    expect(percentChange('5', null)).toBeNull();
  });
});

describe('decimalExceeds', () => {
  it('compares exactly', () => {
    expect(decimalExceeds('10000000.0001', '10000000')).toBe(true);
    expect(decimalExceeds('10000000', '10000000')).toBe(false);
    expect(decimalExceeds('1596029811', '10000000')).toBe(true);
  });
});
