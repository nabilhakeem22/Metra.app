import { describe, expect, it } from 'vitest';
import { marketVariance, priceVariance } from './variance';

describe('marketVariance', () => {
  it('says how far the studio cost sits from the official price, rounded to 1 dp', () => {
    expect(marketVariance({ unit: 'sqm', unitCost: '420.0000' }, { unit: 'sqm', price: '400.0000' })).toEqual({ variancePct: '5.0', reason: 'ok' });
    expect(marketVariance({ unit: 'ton', unitCost: '38200' }, { unit: 'ton', price: '39850' })).toEqual({ variancePct: '-4.1', reason: 'ok' });
  });

  it('compares the new studio units with their market twins, a roll with a roll', () => {
    expect(marketVariance({ unit: 'kg', unitCost: '31' }, { unit: 'kg', price: '30.455' }).reason).toBe('ok');
    expect(marketVariance({ unit: 'roll', unitCost: '2050' }, { unit: 'roll', price: '2050' })).toEqual({ variancePct: '0.0', reason: 'ok' });
  });

  it('has no figure across units: no conversion in v1', () => {
    expect(marketVariance({ unit: 'pcs', unitCost: '10' }, { unit: 'sqm', price: '400' })).toEqual({ variancePct: null, reason: 'unit_mismatch' });
    expect(marketVariance({ unit: 'pcs', unitCost: '10' }, { unit: 'bag', price: '400' }).reason).toBe('unit_mismatch');
  });

  it('has no figure without an official price', () => {
    expect(marketVariance({ unit: 'sqm', unitCost: '420' }, { unit: 'sqm', price: null })).toEqual({ variancePct: null, reason: 'no_price' });
  });

  it('has no figure when the cost is hidden, so the public price cannot give the cost away', () => {
    expect(marketVariance({ unit: 'sqm', unitCost: null }, { unit: 'sqm', price: '400' })).toEqual({ variancePct: null, reason: 'ok' });
    expect(marketVariance({ unit: 'sqm', unitCost: null }, { unit: 'sqm', price: null })).toEqual({ variancePct: null, reason: 'no_price' });
    expect(marketVariance({ unit: 'pcs', unitCost: null }, { unit: 'sqm', price: '400' })).toEqual({ variancePct: null, reason: 'unit_mismatch' });
  });
});

describe('priceVariance (units already matched)', () => {
  it('is the same figure as marketVariance on a compatible pair', () => {
    expect(priceVariance('420.0000', '400.0000')).toEqual(marketVariance({ unit: 'sqm', unitCost: '420.0000' }, { unit: 'sqm', price: '400.0000' }));
  });

  it('has no figure without a price, or against a zero price', () => {
    expect(priceVariance('420', null)).toEqual({ variancePct: null, reason: 'no_price' });
    expect(priceVariance('420', '0')).toEqual({ variancePct: null, reason: 'no_price' });
  });
});
