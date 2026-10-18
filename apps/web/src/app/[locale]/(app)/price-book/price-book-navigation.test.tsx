import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FIRST_VIEW, MAX_SEARCH_LENGTH, readPriceBookView, type PriceBookView } from '@/lib/price-book/page-params';
import { messageAt, messagesFor, renderWithIntl } from '@/test/render-with-intl';
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

  // F1/F2/F4: what the studio typed and chose is authoritative while answers land late.
  describe('with slow answers', () => {
    const client = (view: PriceBookView) => (
      <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="UTC">
        <PriceBookClient view={view} book={BOOK} sections={SECTIONS} canManage={false} />
      </NextIntlClientProvider>
    );
    const box = () => screen.getByPlaceholderText(messageAt('en', 'priceBook.search')) as HTMLInputElement;
    const pause = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, SEARCH_PAUSE_MS + 50)); });
    /** The view the server answers a request with, as the page reads it from the URL. */
    const answer = (href: string) => readPriceBookView(Object.fromEntries(new URL(href, 'http://x').searchParams));

    test('an older answer landing after a newer search was sent never rewrites the box (F1)', async () => {
      const { rerender } = render(client(FIRST_VIEW));
      fireEvent.change(box(), { target: { value: 'gypsum ' } });
      await pause();
      fireEvent.change(box(), { target: { value: 'gypsum board' } });
      await pause();
      fireEvent.change(box(), { target: { value: 'gypsum board 12' } });
      const [first, second] = router.replace.mock.calls.map(([href]) => href as string);
      rerender(client(answer(first)));
      expect(box().value).toBe('gypsum board 12');
      rerender(client(answer(second)));
      expect(box().value).toBe('gypsum board 12');
      await pause();
      expect(router.replace.mock.calls.at(-1)?.[0]).toBe('/price-book?q=gypsum+board+12');
    });

    test('back or forward to another view is adopted by the toolbar', () => {
      const { rerender } = render(client(FIRST_VIEW));
      rerender(client({ ...FIRST_VIEW, query: 'tile', activeOnly: true, page: 2 }));
      expect(box().value).toBe('tile');
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    });

    test('a filter chosen before its page arrives is kept by the search typed next, and moves at once (F2)', async () => {
      render(client(FIRST_VIEW));
      fireEvent.click(screen.getByRole('checkbox'));
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
      fireEvent.change(box(), { target: { value: 'tile' } });
      await pause();
      expect(router.replace.mock.calls.map(([href]) => href)).toEqual(['/price-book?active=1', '/price-book?q=tile&active=1']);
    });

    test('a search past the length cap is cut in the URL only, never in the box (F4)', async () => {
      const { rerender } = render(client(FIRST_VIEW));
      const long = 'gypsum '.padEnd(230, 'x');
      fireEvent.change(box(), { target: { value: long } });
      await pause();
      const [href] = router.replace.mock.calls.at(-1) as [string];
      expect(answer(href).query).toHaveLength(MAX_SEARCH_LENGTH);
      rerender(client(answer(href)));
      expect(box().value).toBe(long);
    });
  });
});
