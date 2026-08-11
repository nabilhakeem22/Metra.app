import { describe, expect, it } from 'vitest';
import {
  computeLine,
  computeSection,
  computeTotals,
  formatMoney4,
  marginPct,
  parseMoney4,
} from './proposal-totals';

describe('parse/format round-trip', () => {
  it('is scale-4 exact', () => {
    expect(formatMoney4(parseMoney4('10.005'))).toBe('10.0050');
    expect(formatMoney4(parseMoney4('-3.3333'))).toBe('-3.3333');
    expect(formatMoney4(parseMoney4('0'))).toBe('0.0000');
  });
});

describe('computeLine (piastre-exact, half-up)', () => {
  it('deterministic on qty=3, unitPrice=10.005, discountPct=10', () => {
    const r = computeLine({
      qty: '3',
      unitCost: '5',
      unitPrice: '10.005',
      discountPct: '10',
    });
    // gross = 30.0150; total = 30.0150 - 3.0015 = 27.0135; cost = 15; margin = 12.0135
    expect(r).toEqual({
      lineCost: '15.0000',
      lineTotal: '27.0135',
      lineMargin: '12.0135',
    });
  });

  it('rounds an exact half UP (0.5 * 0.0001 -> 0.0001)', () => {
    const r = computeLine({
      qty: '0.5',
      unitCost: '0',
      unitPrice: '0.0001',
      discountPct: '0',
    });
    expect(r.lineTotal).toBe('0.0001');
  });
});

describe('computeSection / computeTotals (AC12: sums line up)', () => {
  const s1lines = [
    computeLine({ qty: '2', unitCost: '60', unitPrice: '100', discountPct: '0' }),
    computeLine({ qty: '1', unitCost: '30', unitPrice: '50', discountPct: '10' }),
  ];
  const s2lines = [
    computeLine({ qty: '3', unitCost: '5', unitPrice: '10.005', discountPct: '10' }),
  ];

  it('sectionSubtotal == Σ lineTotal per section', () => {
    const s1 = computeSection(s1lines);
    expect(s1.sectionSubtotal).toBe('245.0000'); // 200 + 45
    const s2 = computeSection(s2lines);
    expect(s2.sectionSubtotal).toBe('27.0135');
  });

  it('subtotal == Σ sectionSubtotal; doc discount+14% tax exact', () => {
    const sections = [computeSection(s1lines), computeSection(s2lines)];
    const t = computeTotals(sections, { discountPct: '5', taxRate: '14' });
    expect(t.subtotal).toBe('272.0135'); // 245 + 27.0135
    expect(t.discountAmount).toBe('13.6007');
    expect(t.taxableBase).toBe('258.4128');
    expect(t.taxAmount).toBe('36.1778');
    expect(t.total).toBe('294.5906');
    expect(t.totalCost).toBe('165.0000'); // 120 + 30 + 15
    expect(t.totalMargin).toBe('93.4128'); // taxableBase - totalCost
  });

  it('marginPct is null when taxable base <= 0', () => {
    expect(marginPct('0', '0')).toBeNull();
    expect(marginPct('50', '200')).toBeCloseTo(25, 5);
  });
});
