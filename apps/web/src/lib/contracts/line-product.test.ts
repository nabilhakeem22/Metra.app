import { describe, expect, it } from 'vitest';
import { totalIsQuantityTimesPrice } from './line-product';

// H6-read F4: the narrow line's "×" claims quantity × unit price = total, so it
// is shown only when that holds in the figures the page shows: the quantity (up
// to 4 decimals) times the 2-decimal unit price, rounded to 2 decimals, equals
// the 2-decimal total.

describe('totalIsQuantityTimesPrice', () => {
  it.each([
    ['220.0000', '65.0000', '14300.0000'],
    ['0.0001', '0.0000', '0.0000'],
    ['1234.5678', '99.9900', '123444.4343'],
    ['0.1250', '125000.2500', '15625.0313'],
    ['9999.9999', '9999999.0000', '99999989000.0001'],
    ['3', '10.0100', '30.0300'],
  ])('%s × %s is %s: true', (qty, unitPrice, lineTotal) => {
    expect(totalIsQuantityTimesPrice({ qty, unit_price: unitPrice, line_total: lineTotal })).toBe(true);
  });

  it('a line with its own 10% discount: false (1,234.5678 × 99.99 is 123,444.4343, not 111,099.99)', () => {
    expect(totalIsQuantityTimesPrice({ qty: '1234.5678', unit_price: '99.9900', line_total: '111099.9900' })).toBe(false);
  });

  it('qty 3, unit price 10.0050, total 30.0150: false (shows 3 × 10.01 = 30.02, not 30.03)', () => {
    expect(totalIsQuantityTimesPrice({ qty: '3.0000', unit_price: '10.0050', line_total: '30.0150' })).toBe(false);
  });

  it('a 4-decimal product whose 2-decimal face matches the shown total: true (0.5 × 0.01 = 0.005 shows 0.01)', () => {
    expect(totalIsQuantityTimesPrice({ qty: '0.5000', unit_price: '0.0100', line_total: '0.0050' })).toBe(true);
  });

  it('a total that differs only past the second decimal still reads as the product', () => {
    expect(totalIsQuantityTimesPrice({ qty: '2', unit_price: '10', line_total: '20.0004' })).toBe(true);
  });

  it('a total that differs at the second decimal: false', () => {
    expect(totalIsQuantityTimesPrice({ qty: '2', unit_price: '10', line_total: '20.0100' })).toBe(false);
  });

  it('reads the stored figures whatever their trailing zeros', () => {
    expect(totalIsQuantityTimesPrice({ qty: '2', unit_price: '1500', line_total: '3000.0000' })).toBe(true);
  });
});
