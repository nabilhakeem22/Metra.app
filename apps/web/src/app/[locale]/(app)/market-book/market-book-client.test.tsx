import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { MarketCategory, MarketItemRow } from '@/lib/market-book/types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { MarketBookClient, type MarketBookClientProps } from './market-book-client';
import { marketRowView } from './market-row-view';

vi.mock('@/lib/market-book/actions', () => ({ addMarketItemToPriceBook: vi.fn(), loadMarketItem: vi.fn() }));

const point = (month: string, price: string) => ({ month, status: 'priced' as const, price, bulletinMonth: '2026-07', sourcePage: 65 });

function row(id: string, overrides: Partial<MarketItemRow> = {}): MarketItemRow {
  const series = [point('2026-06', '380.0000'), point('2026-07', '400.0000')];
  return {
    id, key: `finishing.glass.${id}`, categoryKey: 'finishing.glass', nameAr: `زجاج ${id}`, nameEn: `Glass ${id}`,
    specAr: null, specEn: null, unit: 'sqm', unitLabelAr: 'م2', basisNoteAr: null, status: 'active',
    latest: series[1], series, momPct: '5.3', ytdPct: null, yoyPct: null, linkedCostItem: null,
    latestPriced: { month: '2026-07', price: '400.0000' }, seededNames: { nameAr: `زجاج ${id}`, nameEn: `Glass ${id}` }, ...overrides,
  };
}

const CATEGORIES: MarketCategory[] = [
  { key: 'finishing', nameAr: 'خامات التشطيب', nameEn: 'Finishing materials', parentKey: null, itemCount: 3 },
  { key: 'finishing.glass', nameAr: 'الزجاج', nameEn: 'Glass', parentKey: 'finishing', itemCount: 3 },
];

const ITEMS = [
  row('a'),
  row('bag', { unit: 'bag' }),
  row('never', { latestPriced: null }),
  row('linked', { linkedCostItem: { id: 'c-1', code: 'MKT-x' } }),
].map((item) => marketRowView(item, '2026-07'));

function renderClient(locale: TestLocale, props: Partial<MarketBookClientProps>) {
  renderWithIntl(
    <MarketBookClient
      items={ITEMS} matched={4} categoryKey="finishing.glass" query="" categories={CATEGORIES}
      sections={[]} canAdd={false} attribution={<p>attribution</p>} {...props}
    />,
    { locale },
  );
}

describe.each<TestLocale>(['en', 'ar-EG'])('MarketBookClient (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('a reader (project manager, accountant) sees the prices and no Add (AC 14)', () => {
    renderClient(locale, { canAdd: false });
    expect(screen.queryByRole('button', { name: at('marketBook.add') })).toBeNull();
    expect(screen.getByRole('heading', { name: locale === 'en' ? 'Glass' : 'الزجاج' })).toBeTruthy();
    expect(document.body.textContent).toContain('400.00');
  });

  test('an owner sees Add, disabled for a unit no price book has and for an item never priced, and the link for an item already in it', () => {
    renderClient(locale, { canAdd: true });
    const adds = screen.getAllByRole('button', { name: at('marketBook.add') });
    expect(adds.map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, true, true]);
    const link = screen.getByRole('link', { name: at('marketBook.inPriceBook') });
    expect(link.getAttribute('href')).toContain('/price-book?q=MKT-x');
  });

  test('a search says what matched, and when the list is cut', () => {
    renderClient(locale, { categoryKey: null, query: 'glass', matched: 80 });
    expect(screen.getByRole('heading').textContent).toContain('glass');
    expect(document.body.textContent).toContain(at('marketBook.results.truncated').replace('{shown}', '4'));
  });

  test('a search with nothing matching says so', () => {
    renderClient(locale, { categoryKey: null, query: 'nothing', matched: 0, items: [] });
    expect(screen.getByText(at('marketBook.results.none'))).toBeTruthy();
  });
});
