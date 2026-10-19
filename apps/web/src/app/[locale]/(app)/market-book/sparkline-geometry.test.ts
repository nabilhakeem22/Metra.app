import { describe, expect, it } from 'vitest';
import type { MarketPoint } from '@/lib/market-book/types';
import { sparklineGeometry } from './sparkline-geometry';

const point = (month: string, price: string | null): MarketPoint => ({
  month, status: price === null ? 'suspended' : 'priced', price, bulletinMonth: '2026-07', sourcePage: 1,
});

describe('sparklineGeometry', () => {
  it('draws time left to right and price upwards', () => {
    const { lines, dots } = sparklineGeometry([point('2026-01', '100'), point('2026-02', '200')], 100, 20, 0);
    expect(lines).toEqual(['0,20 100,0']);
    expect(dots).toEqual([]);
  });

  it('breaks the line at a suspended or missing month, and dots a lone month', () => {
    const series = [point('2026-01', '100'), point('2026-02', '100'), point('2026-03', null), point('2026-04', '120'), point('2026-06', '130')];
    const { lines, dots } = sparklineGeometry(series, 50, 10, 0);
    expect(lines).toEqual(['0,10 10,10']);
    expect(dots).toEqual([{ x: 30, y: 3.3 }, { x: 50, y: 0 }]);
  });

  it('draws a flat price across the middle, and nothing without a price', () => {
    expect(sparklineGeometry([point('2026-01', '5'), point('2026-02', '5')], 10, 10, 0).lines).toEqual(['0,5 10,5']);
    expect(sparklineGeometry([point('2026-01', null)], 10, 10)).toEqual({ lines: [], dots: [] });
  });
});
