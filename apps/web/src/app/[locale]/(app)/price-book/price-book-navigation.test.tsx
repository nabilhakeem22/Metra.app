import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FIRST_VIEW, MAX_SEARCH_LENGTH, priceBookViewSearch, readPriceBookView, type PriceBookView } from '@/lib/price-book/page-params';
import { messageAt, messagesFor, renderWithIntl } from '@/test/render-with-intl';
import { PriceBookClient } from './price-book-client';
import type { PriceBookItem, PriceBookPageData } from './types';
import { REQUEST_OVERDUE_MS, SEARCH_PAUSE_MS } from './use-price-book-navigation';

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
// The edit sheet's market link: its actions are not what these tests are about.
vi.mock('@/lib/market-book/actions', () => ({ linkCostItemToMarket: vi.fn(), searchMarketLinks: vi.fn() }));

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
  marketItemId: null,
}));
const BOOK: PriceBookPageData = { rows, sectionCounts: { [SECTION]: 447 }, matched: 447, page: 2, pageCount: 9, hasAnyItem: true };

/** Put `view`'s URL in the address bar, as the router does when it renders a view. */
function addressAt(view: PriceBookView): void {
  window.history.replaceState(null, '', `/en/price-book${priceBookViewSearch(view)}`);
}

/** React entangles every pending async transition: one left open would keep the next test pending. */
const openNavigations: Array<() => void> = [];
const settleOpenNavigations = () => act(async () => openNavigations.splice(0).forEach((done) => done()));
afterEach(settleOpenNavigations);

/** The next router.replace returns a transition the test settles itself: `settle()` ends it. */
function nextRequestSettledBy(): { settle: () => Promise<void> } {
  let resolve = () => {};
  router.replace.mockImplementationOnce((href: string) => {
    window.history.replaceState(null, '', `/en${href}`);
    return new Promise<void>((done) => (resolve = done));
  });
  return {
    settle: async () => {
      await act(async () => resolve());
      await act(async () => {});
    },
  };
}

function show(view: PriceBookView = { ...FIRST_VIEW, page: 2 }, locale: 'en' | 'ar-EG' = 'en') {
  addressAt(view);
  renderWithIntl(<PriceBookClient view={view} book={BOOK} market={{ bulletin: null, refs: {} }} sections={SECTIONS} canManage={false} showsCost />, { locale });
}

beforeEach(async () => {
  await settleOpenNavigations();
  router.replace.mockReset();
  // The router puts the URL it was asked for in the address bar, and the
  // transition stays pending, as a navigation does, until the test ends.
  router.replace.mockImplementation((href: string) => {
    window.history.replaceState(null, '', `/en${href}`);
    return new Promise<void>((done) => openNavigations.push(done));
  });
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
        <PriceBookClient view={view} book={BOOK} market={{ bulletin: null, refs: {} }} sections={SECTIONS} canManage={false} showsCost />
      </NextIntlClientProvider>
    );
    const box = () => screen.getByPlaceholderText(messageAt('en', 'priceBook.search')) as HTMLInputElement;
    const pause = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, SEARCH_PAUSE_MS + 50)); });
    /** The view the server answers a request with, as the page reads it from the URL. */
    const answer = (href: string) => readPriceBookView(Object.fromEntries(new URL(href, 'http://x').searchParams));
    const mount = (view: PriceBookView) => {
      addressAt(view);
      return render(client(view));
    };
    /** A navigation that is not ours: a link (the address bar moves with the view) or Back/Forward (it moves first). */
    function navigateTo(rerender: (ui: React.ReactElement) => void, view: PriceBookView, how: 'link' | 'history') {
      addressAt(view);
      if (how === 'history') act(() => void window.dispatchEvent(new PopStateEvent('popstate')));
      rerender(client(view));
    }
    const ticked = () => (screen.getByRole('checkbox') as HTMLInputElement).checked;

    test('an older answer landing after a newer search was sent never rewrites the box (F1)', async () => {
      const { rerender } = mount(FIRST_VIEW);
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
      const { rerender } = mount(FIRST_VIEW);
      navigateTo(rerender, { ...FIRST_VIEW, query: 'tile', activeOnly: true, page: 2 }, 'history');
      expect(box().value).toBe('tile');
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    });

    test('a filter chosen before its page arrives is kept by the search typed next, and moves at once (F2)', async () => {
      mount(FIRST_VIEW);
      fireEvent.click(screen.getByRole('checkbox'));
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
      fireEvent.change(box(), { target: { value: 'tile' } });
      await pause();
      expect(router.replace.mock.calls.map(([href]) => href)).toEqual(['/price-book?active=1', '/price-book?q=tile&active=1']);
    });

    /** Type (or clear) the box, wait out the pause, and let the server answer the request it sent. */
    async function search(rerender: (ui: React.ReactElement) => void, text: string) {
      fireEvent.change(box(), { target: { value: text } });
      await pause();
      rerender(client(answer(router.replace.mock.calls.at(-1)?.[0] as string)));
    }

    test('Back to a view asked for earlier (and since left) is adopted: the box follows the rows (N1)', async () => {
      const { rerender } = mount(FIRST_VIEW);
      await search(rerender, 'tile');
      await search(rerender, '');
      await search(rerender, 'gyp');
      expect(box().value).toBe('gyp');
      navigateTo(rerender, FIRST_VIEW, 'history');
      expect(box().value).toBe('');
    });

    test('the sidebar link to the bare price book after a filter toggled on, off and on is adopted (N1)', () => {
      const { rerender } = mount(FIRST_VIEW);
      for (let toggle = 0; toggle < 3; toggle += 1) {
        fireEvent.click(screen.getByRole('checkbox'));
        rerender(client(answer(router.replace.mock.calls.at(-1)?.[0] as string)));
      }
      expect(ticked()).toBe(true);
      navigateTo(rerender, FIRST_VIEW, 'link');
      expect(ticked()).toBe(false);
    });

    test('a stale answer while a newer request is unanswered is ignored; the newer one lands and matches', async () => {
      const { rerender } = mount(FIRST_VIEW);
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.change(box(), { target: { value: 'gyp' } });
      await pause();
      const [stale, newer] = router.replace.mock.calls.map(([href]) => href as string);
      rerender(client(answer(stale)));
      expect(box().value).toBe('gyp');
      rerender(client(answer(newer)));
      expect(box().value).toBe('gyp');
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    });

    test('a pager link carries a filter clicked before its page arrived (N2)', () => {
      mount(FIRST_VIEW);
      fireEvent.click(screen.getByRole('checkbox'));
      const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
      expect(links.some((href) => href?.endsWith('/price-book?active=1&page=3'))).toBe(true);
    });

    test('typing after Back builds on the Back view; the Back page and an older answer landing later rewrite nothing (N3)', async () => {
      const { rerender } = mount({ ...FIRST_VIEW, page: 2 });
      fireEvent.click(screen.getByRole('checkbox'));
      // Back: the address bar moves at once, the Back page renders later.
      addressAt(FIRST_VIEW);
      act(() => void window.dispatchEvent(new PopStateEvent('popstate')));
      expect(ticked()).toBe(false);
      fireEvent.change(box(), { target: { value: 'tile' } });
      await pause();
      expect(router.replace.mock.calls.map(([href]) => href)).toEqual(['/price-book?active=1', '/price-book?q=tile']);
      rerender(client(FIRST_VIEW));
      rerender(client(answer('/price-book?active=1')));
      expect(box().value).toBe('tile');
      expect(ticked()).toBe(false);
      rerender(client(answer('/price-book?q=tile')));
      expect(box().value).toBe('tile');
      expect(window.location.search).toBe('?q=tile');
    });

    test('a request the router never renders is asked once more, then given up for the view on screen and its URL', () => {
      vi.useFakeTimers();
      try {
        mount(FIRST_VIEW);
        fireEvent.change(box(), { target: { value: 'tile' } });
        act(() => void vi.advanceTimersByTime(SEARCH_PAUSE_MS));
        act(() => void vi.advanceTimersByTime(REQUEST_OVERDUE_MS));
        expect(router.replace.mock.calls.map(([href]) => href)).toEqual(['/price-book?q=tile', '/price-book?q=tile']);
        expect(box().value).toBe('tile');
        act(() => void vi.advanceTimersByTime(REQUEST_OVERDUE_MS));
        expect(router.replace.mock.calls.at(-1)?.[0]).toBe('/price-book');
        expect(box().value).toBe('');
        act(() => void vi.advanceTimersByTime(REQUEST_OVERDUE_MS * 3));
        expect(router.replace).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    test('a link followed while a request of ours is in flight lands as the view (the sidebar)', () => {
      const { rerender } = mount(FIRST_VIEW);
      fireEvent.click(screen.getByRole('checkbox'));
      const sidebar = document.body.appendChild(document.createElement('a'));
      sidebar.href = '/en/price-book';
      sidebar.addEventListener('click', (event) => event.preventDefault());
      fireEvent.click(sidebar);
      sidebar.remove();
      rerender(client({ ...FIRST_VIEW, page: 2 }));
      expect(ticked()).toBe(false);
    });

    test('Back to the view already on screen leaves nothing to wait for: the next view that lands is adopted', () => {
      const { rerender } = mount({ ...FIRST_VIEW, query: 'tile', page: 2 });
      navigateTo(rerender, { ...FIRST_VIEW, query: 'tile', page: 2 }, 'history');
      navigateTo(rerender, FIRST_VIEW, 'link');
      expect(box().value).toBe('');
    });

    test('tick, Back, tick again at once: the second tick is kept (N4)', async () => {
      const { rerender } = mount({ ...FIRST_VIEW, page: 2 });
      const first = nextRequestSettledBy();
      fireEvent.click(screen.getByRole('checkbox'));
      navigateTo(rerender, FIRST_VIEW, 'history');
      expect(ticked()).toBe(false);
      fireEvent.click(screen.getByRole('checkbox'));
      expect(ticked()).toBe(true);
      await first.settle();
      rerender(client(FIRST_VIEW));
      expect(ticked()).toBe(true);
      rerender(client(answer('/price-book?active=1')));
      expect(ticked()).toBe(true);
      expect(router.replace.mock.calls.map(([href]) => href)).toEqual(['/price-book?active=1', '/price-book?active=1']);
    });

    test('a search past the length cap is cut in the URL only, never in the box (F4)', async () => {
      const { rerender } = mount(FIRST_VIEW);
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
