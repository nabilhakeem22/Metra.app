import { describe, expect, it } from 'vitest';
import { computeLine } from './proposal-totals';
import {
  computeRevisedContractValue,
  computeVariationNetDelta,
} from './contract-value';

describe('computeVariationNetDelta', () => {
  it('sums positive line totals', () => {
    const lines = [
      computeLine({ qty: '2', unitCost: '10', unitPrice: '100', discountPct: '0' }),
      computeLine({ qty: '1', unitCost: '5', unitPrice: '50', discountPct: '10' }),
    ];
    // 200 + 45 = 245
    expect(computeVariationNetDelta(lines)).toBe('245.0000');
  });

  it('yields a NEGATIVE delta for a de-scope (negative qty)', () => {
    const lines = [
      computeLine({ qty: '-3', unitCost: '0', unitPrice: '100', discountPct: '0' }),
    ];
    expect(computeVariationNetDelta(lines)).toBe('-300.0000');
  });

  it('nets positive and negative scope changes', () => {
    const lines = [
      computeLine({ qty: '1', unitCost: '0', unitPrice: '500', discountPct: '0' }),
      computeLine({ qty: '-2', unitCost: '0', unitPrice: '100', discountPct: '0' }),
    ];
    // 500 - 200 = 300
    expect(computeVariationNetDelta(lines)).toBe('300.0000');
  });

  it('is 0 for no lines', () => {
    expect(computeVariationNetDelta([])).toBe('0.0000');
  });
});

describe('computeRevisedContractValue', () => {
  it('adds approved deltas to the original value', () => {
    expect(computeRevisedContractValue('100000', ['5000', '2500.5'])).toBe(
      '107500.5000',
    );
  });

  it('handles a net-negative revision below the original', () => {
    expect(computeRevisedContractValue('100000', ['-30000', '5000'])).toBe(
      '75000.0000',
    );
  });

  it('returns the original when there are no approved deltas', () => {
    expect(computeRevisedContractValue('100000', [])).toBe('100000.0000');
  });
});

// F1: sign-symmetric rounding — a de-scope must be the exact inverse of the add
// it reverses, to the piastre, even where the money rounds on an exact half.
describe('F1 sign-symmetric rounding', () => {
  it('computeLine(-qty) negates computeLine(+qty) at a half-rounding input', () => {
    const pos = computeLine({ qty: '1', unitPrice: '0.3333', discountPct: '50', unitCost: '0' });
    const neg = computeLine({ qty: '-1', unitPrice: '0.3333', discountPct: '50', unitCost: '0' });
    // gross 0.3333, discount 0.16665 -> rounds AWAY FROM ZERO to 0.1667 (and
    // -0.1667 for the negative), so lineTotal = 0.1666 and -0.1666: exact inverse.
    expect(neg.lineTotal).toBe(`-${pos.lineTotal.replace(/^-/, '')}`);
    expect(pos.lineTotal).toBe('0.1666');
    expect(neg.lineTotal).toBe('-0.1666');
  });

  it('a +VO and an identical −VO net the revised value back to baseline (register 0)', () => {
    const add = computeVariationNetDelta([
      computeLine({ qty: '1', unitPrice: '0.3333', discountPct: '50', unitCost: '0' }),
    ]);
    const cut = computeVariationNetDelta([
      computeLine({ qty: '-1', unitPrice: '0.3333', discountPct: '50', unitCost: '0' }),
    ]);
    expect(computeRevisedContractValue('100000', [add, cut])).toBe('100000.0000');
    // The project register (Σ approved deltas) nets to exactly 0.
    expect(computeVariationNetDelta([
      { lineCost: '0', lineTotal: add, lineMargin: '0' },
      { lineCost: '0', lineTotal: cut, lineMargin: '0' },
    ])).toBe('0.0000');
  });
});
