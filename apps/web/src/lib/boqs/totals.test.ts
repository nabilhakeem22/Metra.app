import { describe, expect, it } from 'vitest';
import { computeLine, computeSection } from '@/lib/aggregates/proposal-totals';
import { computeBoqTotals } from './totals';

const line = (qty: string, price: string, cost = '0', discountPct = '0') =>
  computeLine({ qty, unitPrice: price, unitCost: cost, discountPct });

describe('computeBoqTotals', () => {
  it('stops at total = subtotal - discount, with no tax or supervision', () => {
    // The whole point of the BOQ's shorter chain: it prices the works, and the
    // commercial wrapper is added when it becomes a contract.
    const s = computeSection([line('100', '1500'), line('45', '220')]);
    const t = computeBoqTotals([s], { discountPct: '0' });
    expect(t.subtotal).toBe('159900.0000');
    expect(t.total).toBe('159900.0000');
    expect(Object.keys(t).sort()).toEqual(
      ['discountAmount', 'subtotal', 'total', 'totalCost', 'totalMargin'].sort(),
    );
  });

  it('takes the discount out of margin, not out of cost', () => {
    // A studio that discounts 10% should see margin fall by exactly that amount.
    const s = computeSection([line('10', '100', '60')]);
    const full = computeBoqTotals([s], { discountPct: '0' });
    const cut = computeBoqTotals([s], { discountPct: '10' });
    expect(full.totalMargin).toBe('400.0000');
    expect(cut.discountAmount).toBe('100.0000');
    expect(cut.total).toBe('900.0000');
    expect(cut.totalMargin).toBe('300.0000');
    expect(cut.totalCost).toBe(full.totalCost);
  });

  it('sums sections rather than re-deriving them', () => {
    const a = computeSection([line('10', '100')]);
    const b = computeSection([line('5', '200')]);
    expect(computeBoqTotals([a, b], { discountPct: '0' }).subtotal).toBe(
      '2000.0000',
    );
  });

  it('is exact at four decimals — no float drift across many lines', () => {
    // 3 x 0.0001 must be 0.0003, not 0.00029999999999999997.
    const s = computeSection([
      line('1', '0.0001'),
      line('1', '0.0001'),
      line('1', '0.0001'),
    ]);
    expect(computeBoqTotals([s], { discountPct: '0' }).total).toBe('0.0003');
  });

  it('is empty-safe', () => {
    const t = computeBoqTotals([], { discountPct: '15' });
    expect(t.subtotal).toBe('0.0000');
    expect(t.total).toBe('0.0000');
    expect(t.totalMargin).toBe('0.0000');
  });

  it('agrees with the contract engine on what a line is worth', () => {
    // A BOQ line becomes a contract line verbatim; if these ever disagreed, a
    // generated contract would not reconcile to the BOQ it came from.
    const l = line('100', '1500', '900', '5');
    expect(l.lineTotal).toBe('142500.0000');
    expect(l.lineCost).toBe('90000.0000');
    expect(l.lineMargin).toBe('52500.0000');
  });
});
