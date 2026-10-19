import { describe, expect, it } from 'vitest';
import type { MarketItemRow, MarketPoint } from '@/lib/market-book/types';
import { marketRowView } from './market-row-view';

const point = (month: string, price: string | null): MarketPoint => ({
  month, status: price === null ? 'suspended' : 'priced', price, bulletinMonth: '2026-07', sourcePage: 110,
});

const row = (series: MarketPoint[]): MarketItemRow => ({
  id: 'm-1', key: 'roads.bearings_joints.c2', categoryKey: 'roads.bearings_joints', nameAr: 'ركائز', nameEn: 'Bearings',
  specAr: null, specEn: null, unit: 'pcs', unitLabelAr: 'عدد', basisNoteAr: null, status: 'active',
  latest: series.at(-1) ?? null, series, momPct: null, ytdPct: null, yoyPct: '1.0', linkedCostItem: null,
});

describe('marketRowView', () => {
  it('keeps a suspended newest month as such, and offers the newest priced one as the cost', () => {
    const view = marketRowView(row([point('2026-05', '31019'), point('2026-06', '31500'), point('2026-07', null)]));
    expect(view.latest).toEqual({ month: '2026-07', price: null });
    expect(view.latestPriced).toEqual({ month: '2026-06', price: '31500' });
    expect(view.trend.lines).toHaveLength(1);
  });

  it('sends no series, page or bulletin per month to the browser', () => {
    const view = marketRowView(row([point('2026-07', '10')]));
    expect(Object.keys(view)).not.toContain('series');
    expect(Object.keys(view)).not.toContain('yoyPct');
    expect(JSON.stringify(view)).not.toContain('bulletinMonth');
  });

  it('has nothing to offer when no month is priced', () => {
    expect(marketRowView(row([point('2026-07', null)])).latestPriced).toBeNull();
    expect(marketRowView(row([])).latest).toBeNull();
  });
});
