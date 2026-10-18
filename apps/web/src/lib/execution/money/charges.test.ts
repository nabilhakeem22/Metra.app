import { describe, expect, it } from 'vitest';
import { contractTotalsFromBoq, type BoqTotalsSnapshot } from './charges';

const boq: BoqTotalsSnapshot = {
  subtotal: '110000',
  discountPct: '9.0909',
  discountAmount: '10000',
  total: '100000.0000',
  totalCost: '70000',
  totalMargin: '30000',
};

describe('contractTotalsFromBoq', () => {
  it('AC4: VAT 14 and supervision 10 on a BOQ total of 100,000.0000', () => {
    const totals = contractTotalsFromBoq(boq, { taxRate: '14', supervisionPct: '10' });
    expect(totals.taxableBase).toBe('100000.0000');
    expect(totals.taxAmount).toBe('14000.0000');
    expect(totals.supervisionAmount).toBe('10000.0000');
    expect(totals.originalValue).toBe('124000.0000');
  });

  it('copies the frozen BOQ figures in canonical scale 4', () => {
    const totals = contractTotalsFromBoq(boq, { taxRate: '14', supervisionPct: '0' });
    expect(totals).toMatchObject({
      subtotal: '110000.0000',
      discountPct: '9.0909',
      discountAmount: '10000.0000',
      taxRate: '14.0000',
      supervisionPct: '0.0000',
      totalCost: '70000.0000',
      totalMargin: '30000.0000',
    });
  });

  it('takes the BOQ total as the base to the piastre, never recomputed', () => {
    // A subtotal minus a discount that would disagree with `total` by a piastre:
    // the frozen total wins.
    const odd = { ...boq, subtotal: '100.0001', discountAmount: '0', total: '100.0000' };
    expect(contractTotalsFromBoq(odd, { taxRate: '0', supervisionPct: '0' }).taxableBase).toBe('100.0000');
  });

  it('rounds VAT and supervision half away from zero (pctOf)', () => {
    // 0.0005 x 10% = 0.00005 -> 0.0001 ; 0.0005 x 14% = 0.00007 -> 0.0001
    const tiny = { ...boq, total: '0.0005' };
    const totals = contractTotalsFromBoq(tiny, { taxRate: '14', supervisionPct: '10' });
    expect(totals.taxAmount).toBe('0.0001');
    expect(totals.supervisionAmount).toBe('0.0001');
    expect(totals.originalValue).toBe('0.0007');
  });

  it('a studio that is not VAT registered types 0 and the value is the base', () => {
    const totals = contractTotalsFromBoq(boq, { taxRate: '0', supervisionPct: '0' });
    expect(totals.taxAmount).toBe('0.0000');
    expect(totals.originalValue).toBe('100000.0000');
  });
});
