import { percentChange } from '@metra/db/market-percent';
import { describe, expect, it } from 'vitest';
import { marketChanges, shiftMonth } from './change';
import type { MarketPoint } from './types';

const priced = (month: string, price: string): MarketPoint => ({ month, status: 'priced', price, bulletinMonth: '2026-07', sourcePage: 1 });
const suspended = (month: string): MarketPoint => ({ month, status: 'suspended', price: null, bulletinMonth: '2026-07', sourcePage: 1 });

describe('percentChange (AC 10)', () => {
  it('rounds half away from zero to one decimal, and has no base for 0', () => {
    expect(percentChange('38200', '39850')).toBe('4.3');
    expect(percentChange('0', '5')).toBeNull();
    expect(percentChange('4429.0000', '4296.0000')).toBe('-3.0');
  });
});

describe('shiftMonth', () => {
  it('crosses year boundaries both ways', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-07', -12)).toBe('2025-07');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
  });
});

describe('marketChanges', () => {
  it('compares the newest month with the month before, January and a year earlier', () => {
    const series = [priced('2025-07', '36000'), priced('2026-01', '38200'), priced('2026-06', '38200'), priced('2026-07', '39850')];
    expect(marketChanges(series)).toEqual({ momPct: '4.3', ytdPct: '4.3', yoyPct: '10.7' });
  });

  it('never skips a gap: a missing previous month is null, not the one before it (AC 10)', () => {
    const series = [priced('2026-01', '100'), priced('2026-05', '110'), priced('2026-07', '121')];
    expect(marketChanges(series).momPct).toBeNull();
    expect(marketChanges(series).ytdPct).toBe('21.0');
  });

  it('is null against a suspended previous month (AC 10)', () => {
    const series = [priced('2026-01', '100'), suspended('2026-06'), priced('2026-07', '121')];
    expect(marketChanges(series).momPct).toBeNull();
  });

  it('has no change at all for a suspended newest month', () => {
    expect(marketChanges([priced('2026-06', '100'), suspended('2026-07')])).toEqual({ momPct: null, ytdPct: null, yoyPct: null });
  });

  it('has no YTD in January, and no YoY until that month exists', () => {
    const series = [priced('2025-12', '90'), priced('2026-01', '99')];
    expect(marketChanges(series)).toEqual({ momPct: '10.0', ytdPct: null, yoyPct: null });
  });

  it('is empty for no series', () => {
    expect(marketChanges([])).toEqual({ momPct: null, ytdPct: null, yoyPct: null });
  });
});
