import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FIRST_VIEW, type PriceBookView } from '@/lib/price-book/page-params';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { PriceBookClient } from './price-book-client';
import type { PriceBookItem, PriceBookPageData } from './types';
import { SEARCH_PAUSE_MS } from './use-price-book-navigation';

// The paged price book keeps its view in the URL: typing searches once it
// pauses, a filter starts again at page 1, and the pager is made of real links.

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
vi.mock('@/lib/price-book/actions', () => ({ setCostItemActive: vi.fn(), loadMarketPriceBook: vi.fn() }));
vi.mock('@/lib/sections/actions', () => ({ addSection: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const SECTION = '0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f';
const SECTIONS = [{ id: SECTION, key: 'civil', nameEn: 'Civil', nameAr: 'مدني' }];
const rows: PriceBookItem[] = Array.from({ length: 50 }, (_, n) => ({
  id: `i-${n}`,
  code: `C-${n}`,
  nameEn: `Board ${n}`,
  nameAr: null,
  sectionId: SECTION,
  unit: 'sqm',
  defaultUnitCost: '1',
  defaultUnitPrice: '2',
  taxCode: null,
  etaItemCode: null,
  etaCodeType: null,
  active: true,
}));
const BOOK: PriceBookPageData = { rows, sectionCounts: { [SECTION]: 447 }, matched: 447, page: 2, pageCount: 9, hasAnyItem: true };

function show(view: PriceBookView = { ...FIRST_VIEW, page: 2 }, locale: 'en' | 'ar-EG' = 'en') {
  renderWithIntl(<PriceBookClient view={view} book={BOOK} sections={SECTIONS} canManage={false} />, { locale });
}

beforeEach(() => {
  router.replace.mockReset();
});

describe('the paged price book', () => {
  test('typing searches once it pauses, from page 1, and not on every key', async () => {
    show();
    const box = screen.getByPlaceholderText(messageAt('en', 'priceBook.search'));
    fireEvent.change(box, { target: { value: 'نح' } });
    fireEvent.change(box, { target: { value: 'نحاس' } });
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_PAUSE_MS + 50));
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace.mock.calls[0][0]).toBe(`/price-book?q=${encodeURIComponent('نحاس')}`);
  });

  test('"active only" keeps the search and the section, and starts at page 1', () => {
    show({ query: 'board', sectionId: SECTION, activeOnly: false, page: 4 });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(router.replace.mock.calls[0][0]).toBe(`/price-book?q=board&section=${SECTION}&active=1`);
  });

  test('says which rows it shows, in Latin digits, with links to the pages either side', () => {
    show({ ...FIRST_VIEW, page: 2 }, 'ar-EG');
    const nav = screen.getByRole('navigation', { name: messageAt('ar-EG', 'priceBook.pager.label') });
    expect(nav.textContent).toContain('51');
    expect(nav.textContent).toContain('100');
    expect(nav.textContent).toContain('447');
    expect(nav.textContent).not.toMatch(/[٠-٩۰-۹]/);
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links.some((href) => href?.endsWith('/price-book'))).toBe(true);
    expect(links.some((href) => href?.endsWith('/price-book?page=3'))).toBe(true);
  });

  test('a section heading counts the section on every page, not this page only', () => {
    show();
    const heading = screen.getByRole('heading', { name: 'Civil' });
    expect(heading.parentElement?.textContent).toContain('447');
  });
});
