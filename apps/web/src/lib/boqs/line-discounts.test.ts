import { describe, expect, it } from 'vitest';
import { computeLine, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { hasLineDiscounts, isLineDiscounted, lineDiscountTotals } from './line-discounts';

const line = (qty: string, unitPrice: string, discountPct: string) => ({
  qty,
  unitPrice,
  discountPct,
  lineTotal: computeLine({ qty, unitPrice, unitCost: '0', discountPct }).lineTotal,
});

describe('hasLineDiscounts (F1)', () => {
  it('is false when every line is at zero, however the zero is written', () => {
    expect(isLineDiscounted({ discountPct: '0' })).toBe(false);
    expect(isLineDiscounted({ discountPct: '0.0000' })).toBe(false);
    expect(hasLineDiscounts([{ lines: [line('10', '100', '0'), line('2', '5', '0.0000')] }])).toBe(
      false,
    );
    expect(hasLineDiscounts([])).toBe(false);
  });

  it('is true when ANY line, in any section, carries a discount', () => {
    expect(
      hasLineDiscounts([
        { lines: [line('10', '100', '0')] },
        { lines: [line('1', '50', '0.5')] },
      ]),
    ).toBe(true);
  });
});

describe('lineDiscountTotals (F1)', () => {
  it('gross minus line discounts is exactly the sum of the stored line totals', () => {
    const sections = [
      { lines: [line('100', '1500', '0'), line('45', '220', '10')] },
      { lines: [line('3', '33.3333', '12.5')] },
    ];
    const { gross, lineDiscounts } = lineDiscountTotals(sections);
    const stored = sections
      .flatMap((s) => s.lines)
      .reduce((sum, l) => sum + parseMoney4(l.lineTotal), 0n);
    expect(formatMoney4(parseMoney4(gross) - parseMoney4(lineDiscounts))).toBe(
      formatMoney4(stored),
    );
    // 45 x 220 = 9900, 10% = 990; 3 x 33.3333 = 99.9999, 12.5% = 12.5000 (rounded).
    expect(lineDiscounts).toBe('1002.5000');
    expect(gross).toBe('159999.9999');
  });

  it('is zero discounts and the plain gross when nothing is discounted', () => {
    expect(lineDiscountTotals([{ lines: [line('2', '10', '0')] }])).toEqual({
      gross: '20.0000',
      lineDiscounts: '0.0000',
    });
  });
});
