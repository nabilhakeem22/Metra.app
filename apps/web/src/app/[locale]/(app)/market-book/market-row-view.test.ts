import { describe, expect, it } from 'vitest';
import type { MarketItemRow, MarketPoint } from '@/lib/market-book/types';
import { marketRowView } from './market-row-view';

const point = (month: string, price: string | null): MarketPoint => ({
  month, status: price === null ? 'suspended' : 'priced', price, bulletinMonth: '2026-07', sourcePage: 110,
});

const row = (series: MarketPoint[], latestPriced: MarketItemRow['latestPriced'] = null): MarketItemRow => ({
  id: 'm-1', key: 'roads.bearings_joints.c2', categoryKey: 'roads.bearings_joints', nameAr: 'ركائز', nameEn: 'Bearings',
  specAr: null, specEn: null, unit: 'pcs', unitLabelAr: 'عدد', basisNoteAr: null, status: 'active',
  latest: series.at(-1) ?? null, series, momPct: null, ytdPct: null, yoyPct: '1.0', linkedCostItem: null,
  latestPriced, seededNames: { nameAr: 'ركائز', nameEn: 'Bearings' },
});

describe('marketRowView', () => {
  it('keeps a suspended newest month as such, and offers the whole history\'s newest priced month as the cost', () => {
    const view = marketRowView(row([point('2026-05', '31019'), point('2026-06', '31500'), point('2026-07', null)], { month: '2026-06', price: '31500' }), '2026-07');
    expect(view.latest).toEqual({ month: '2026-07', price: null });
    expect(view.latestPriced).toEqual({ month: '2026-06', price: '31500' });
    expect(view.latestPricedIsOld).toBe(false);
    expect(view.trend.lines).toHaveLength(1);
  });

  it('says a cost from before the window is old: the window is the newest bulletin and the 12 months before it', () => {
    const suspended = [point('2026-08', null), point('2026-09', null)];
    expect(marketRowView(row(suspended, { month: '2025-09', price: '777' }), '2026-09').latestPricedIsOld).toBe(false);
    expect(marketRowView(row(suspended, { month: '2025-08', price: '777' }), '2026-09').latestPricedIsOld).toBe(true);
    expect(marketRowView(row(suspended, { month: '2024-06', price: '777' }), '2026-09').latestPriced).toEqual({ month: '2024-06', price: '777' });
  });

  it('sends no series, page or bulletin per month to the browser', () => {
    const view = marketRowView(row([point('2026-07', '10')]), '2026-07');
    expect(Object.keys(view)).not.toContain('series');
    expect(Object.keys(view)).not.toContain('yoyPct');
    expect(JSON.stringify(view)).not.toContain('bulletinMonth');
  });

  it('has nothing to offer when no month was ever priced', () => {
    expect(marketRowView(row([point('2026-07', null)]), '2026-07').latestPriced).toBeNull();
    expect(marketRowView(row([point('2026-07', null)]), '2026-07').latestPricedIsOld).toBe(false);
    expect(marketRowView(row([]), '2026-07').latest).toBeNull();
  });
});
