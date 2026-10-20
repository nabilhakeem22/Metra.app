import { describe, expect, it } from 'vitest';
import { approvedVariationsCharge, isVariationBillable, variationCharge } from './variation-charge';

describe('variationCharge', () => {
  it('AC19: net 10,000 with VAT 14 and supervision 10 (D4) bills 12,400.0000', () => {
    expect(variationCharge('10000', '14', '10')).toEqual({
      works: '10000.0000',
      tax: '1400.0000',
      supervision: '1000.0000',
      total: '12400.0000',
    });
  });

  it('a de-scope charges the exact negative of the add it reverses', () => {
    const add = variationCharge('333.3333', '14', '10');
    const cut = variationCharge('-333.3333', '14', '10');
    expect(cut.works).toBe(`-${add.works}`);
    expect(cut.tax).toBe(`-${add.tax}`);
    expect(cut.supervision).toBe(`-${add.supervision}`);
    expect(cut.total).toBe(`-${add.total}`);
  });

  it('rounds VAT and supervision half away from zero', () => {
    // 0.0005 x 10% = 0.00005 -> 0.0001
    expect(variationCharge('0.0005', '0', '10').supervision).toBe('0.0001');
    expect(variationCharge('-0.0005', '0', '10').supervision).toBe('-0.0001');
  });
});

describe('isVariationBillable', () => {
  it('only an order that adds money is billed on its own', () => {
    expect(isVariationBillable('10000')).toBe(true);
    expect(isVariationBillable('0.0001')).toBe(true);
  });

  it('a negative change order is not billable, and neither is a zero one', () => {
    expect(isVariationBillable('-2500')).toBe(false);
    expect(isVariationBillable('0')).toBe(false);
    expect(isVariationBillable('0.0000')).toBe(false);
  });
});

describe('approvedVariationsCharge', () => {
  it('sums each order\'s full charge, each rounded on its own (the F1 repro: 25,420.01)', () => {
    expect(approvedVariationsCharge(['10000', '10000', '0', '1000.0043', '-500'], '14', '10')).toBe('25420.0053');
  });

  it('no approved order adds nothing', () => {
    expect(approvedVariationsCharge([], '14', '10')).toBe('0.0000');
  });
});
