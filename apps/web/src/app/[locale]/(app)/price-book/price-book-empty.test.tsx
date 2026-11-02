import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { FIRST_VIEW } from '@/lib/price-book/page-params';
import { PriceBookClient } from './price-book-client';
import type { PriceBookPageData } from './types';

// An empty price book offers the official market price book (the sign-up seed,
// again) and says which happened: loaded, nothing new, the book still being
// prepared, or nothing published yet. Counts in Latin digits in both languages.

const priceBook = vi.hoisted(() => ({
  bulkUpdatePrices: vi.fn(),
  parseCostImport: vi.fn(),
  importCostItems: vi.fn(),
  findExistingCostItemCodes: vi.fn(),
  setCostItemActive: vi.fn(),
  loadMarketPriceBook: vi.fn(),
  createCostItem: vi.fn(),
  updateCostItem: vi.fn(),
}));
vi.mock('@/lib/price-book/actions', () => priceBook);
vi.mock('@/lib/sections/actions', () => ({ addSection: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
// The edit sheet's market link: its actions are not what these tests are about.
vi.mock('@/lib/market-book/actions', () => ({ linkCostItemToMarket: vi.fn(), searchMarketLinks: vi.fn() }));

/** A book with nothing in it at all (not a filter that matched nothing). */
const EMPTY_BOOK: PriceBookPageData = { rows: [], sectionCounts: {}, matched: 0, page: 1, pageCount: 1, hasAnyItem: false };

beforeEach(() => {
  priceBook.loadMarketPriceBook.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the empty price book (%s)', (locale) => {
  async function load(data: { book: 'ready' | 'preparing' | 'unpublished'; sections: number; items: number }) {
    priceBook.loadMarketPriceBook.mockResolvedValue({ ok: true, data });
    renderWithIntl(<PriceBookClient view={FIRST_VIEW} book={EMPTY_BOOK} market={{ bulletin: null, refs: {} }} sections={[]} canManage showsCost />, { locale });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'priceBook.empty.loadMarketBook') }));
    });
    expect(priceBook.loadMarketPriceBook).toHaveBeenCalledTimes(1);
    return toast.mock.calls[0][0].title as string;
  }

  it('says how many market items it loaded, in Latin digits', async () => {
    const title = await load({ book: 'ready', sections: 55, items: 447 });
    expect(title).toContain('447');
    expect(title).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('says the book already has every market item when nothing was new', async () => {
    expect(await load({ book: 'ready', sections: 0, items: 0 })).toBe(messageAt(locale, 'priceBook.toast.marketUpToDate'));
  });

  it('says nothing is published yet when there is no bulletin', async () => {
    expect(await load({ book: 'unpublished', sections: 0, items: 0 })).toBe(messageAt(locale, 'priceBook.toast.marketNotPublished'));
  });

  it('says the book is being prepared when a bulletin is published but its book is not built yet', async () => {
    expect(await load({ book: 'preparing', sections: 0, items: 0 })).toBe(messageAt(locale, 'priceBook.toast.marketPreparing'));
  });

  it('offers no load to a studio member who cannot manage the book', () => {
    renderWithIntl(<PriceBookClient view={FIRST_VIEW} book={EMPTY_BOOK} market={{ bulletin: null, refs: {} }} sections={[]} canManage={false} showsCost />, { locale });
    expect(screen.queryByRole('button', { name: messageAt(locale, 'priceBook.empty.loadMarketBook') })).toBeNull();
  });
});
