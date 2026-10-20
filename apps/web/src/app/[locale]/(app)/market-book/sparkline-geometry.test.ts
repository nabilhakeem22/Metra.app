import { describe, expect, it } from 'vitest';
import { shiftMonth } from '@/lib/market-book/change';
import type { MarketPoint } from '@/lib/market-book/types';
import { sparklineGeometry } from './sparkline-geometry';

const point = (month: string, price: string | null): MarketPoint => ({
  month, status: price === null ? 'suspended' : 'priced', price, bulletinMonth: '2026-07', sourcePage: 1,
});

// A 120-wide line with no inset: each of the 12 steps of the window is 10 wide.
const WIDTH = 120;

describe('sparklineGeometry', () => {
  it('draws time left to right and price upwards, each month at its place in the window', () => {
    const { lines, dots } = sparklineGeometry([point('2026-06', '100'), point('2026-07', '200')], '2026-07', WIDTH, 20, 0);
    expect(lines).toEqual(['110,20 120,0']);
    expect(dots).toEqual([]);
  });

  it('puts the same months at the same x in every row: two months are never stretched across the width', () => {
    const full = Array.from({ length: 13 }, (_, index) => point(shiftMonth('2025-09', index), String(100 + index)));
    const line = sparklineGeometry(full, '2026-09', WIDTH, 20, 0).lines[0].split(' ');
    expect([line[0], line.at(-1)]).toEqual(['0,20', '120,0']);
    const two = sparklineGeometry([point('2026-07', '100'), point('2026-09', '120')], '2026-09', WIDTH, 20, 0);
    expect(two).toEqual({ lines: [], dots: [{ x: 100, y: 20 }, { x: 120, y: 0 }] });
  });

  it('breaks the line at a suspended or missing month, and dots a lone month', () => {
    const series = [point('2026-01', '100'), point('2026-02', '100'), point('2026-03', null), point('2026-04', '120'), point('2026-06', '130')];
    const { lines, dots } = sparklineGeometry(series, '2026-06', WIDTH, 10, 0);
    expect(lines).toEqual(['70,10 80,10']);
    expect(dots).toEqual([{ x: 100, y: 3.3 }, { x: 120, y: 0 }]);
  });

  it('draws nothing outside the window, a flat price across the middle, and nothing without a price', () => {
    expect(sparklineGeometry([point('2025-06', '5'), point('2026-07', '9')], '2026-07', WIDTH, 10, 0)).toEqual({ lines: [], dots: [{ x: 120, y: 5 }] });
    expect(sparklineGeometry([point('2026-01', '5'), point('2026-02', '5')], '2026-02', WIDTH, 10, 0).lines).toEqual(['110,5 120,5']);
    expect(sparklineGeometry([point('2026-01', null)], '2026-01', WIDTH, 10)).toEqual({ lines: [], dots: [] });
  });
});
