import { act, fireEvent, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProposalListRow } from '@/lib/proposals/queries';
import { registerViewSearch, type RegisterView } from '@/lib/registers/register-view';
import { messageAt, messagesFor, renderWithIntl } from '@/test/render-with-intl';
import { ProposalsClient, type ProposalsClientProps } from './proposals-client';
import { SEARCH_PAUSE_MS } from './use-proposal-search';

// The register searches on the server: typing replaces ?q= once it pauses (at
// page 1), the box is never rewritten by an answer to its own search, and a
// search that matches nothing keeps the box instead of the "no proposals" state.

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));

const row: ProposalListRow = {
  id: 'p-1',
  number: 12,
  titleAr: null,
  titleEn: 'Villa fit-out',
  status: 'draft',
  kind: 'quote',
  total: '1000.0000',
  currency: 'EGP',
  issueDate: '2026-03-01',
  createdAt: '2026-03-01T00:00:00.000Z',
  clientNameEn: 'Acme',
  clientNameAr: null,
  projectNameEn: 'Villa',
  projectNameAr: null,
};

const BASE: ProposalsClientProps = {
  items: [row],
  hasAnyProposal: true,
  view: { query: '', page: 1 },
  canManage: true,
  hasClients: true,
  pager: <nav aria-label="the pager" />,
};

/** Put `view`'s URL in the address bar, as the router does when it renders a view. */
function addressAt(view: RegisterView): void {
  window.history.replaceState(null, '', `/en/proposals${registerViewSearch(view)}`);
}

function show(props: Partial<ProposalsClientProps> = {}) {
  addressAt(props.view ?? BASE.view);
  const register = renderWithIntl(<ProposalsClient {...BASE} {...props} />, { locale: 'en' });
  /** The same page rendered again by the server, as a navigation does: the address bar moves with it. */
  const again = (next: Partial<ProposalsClientProps>) => {
    addressAt(next.view ?? props.view ?? BASE.view);
    register.rerender(
      <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="UTC">
        <ProposalsClient {...BASE} {...props} {...next} />
      </NextIntlClientProvider>,
    );
  };
  return { again };
}

const searchBox = () => screen.getByPlaceholderText(messageAt('en', 'proposals.search')) as HTMLInputElement;
const type = (text: string) => fireEvent.change(searchBox(), { target: { value: text } });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** A link followed in the page; the click is cancelled after every listener saw it, so jsdom stays put. */
function follow(link: HTMLElement) {
  link.addEventListener('click', (event) => event.preventDefault());
  fireEvent.click(link);
}
/** Back or Forward: the address bar moves at once, the view it names renders later. */
function historyTo(view: RegisterView) {
  addressAt(view);
  act(() => void window.dispatchEvent(new PopStateEvent('popstate')));
}
/** The server's pager: a real link to the next page of what the page was loaded with. */
const pagerTo = (view: RegisterView) => (
  <nav aria-label="the pager">
    <a href={`/en/proposals${registerViewSearch(view)}`}>Next</a>
  </nav>
);

beforeEach(() => {
  vi.useFakeTimers();
  router.replace.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('ProposalsClient', () => {
  test('a studio with no proposal at all sees the empty state, not a search', () => {
    show({ items: [], hasAnyProposal: false });
    expect(screen.getByText(messageAt('en', 'proposals.empty.title'))).toBeTruthy();
    expect(screen.queryByPlaceholderText(messageAt('en', 'proposals.search'))).toBeNull();
  });

  test('a search that matches nothing keeps the box and the table, with no row', () => {
    show({ items: [], view: { query: 'nothing like this', page: 1 } });
    expect(searchBox().value).toBe('nothing like this');
    expect(screen.getByText(messageAt('en', 'proposals.table.number'))).toBeTruthy();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  test('the rows and the pager the server rendered are shown', () => {
    show();
    expect(screen.getByText('Villa fit-out')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'the pager' })).toBeTruthy();
  });

  test('typing searches once it pauses, at page 1, replacing the URL', () => {
    show({ view: { query: '', page: 1 } });
    fireEvent.change(searchBox(), { target: { value: 'v' } });
    fireEvent.change(searchBox(), { target: { value: 'vil' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS - 1));
    expect(router.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/proposals?q=vil', { scroll: false });
  });

  test('clearing the box shows every proposal again; blanks are no search', () => {
    show({ view: { query: 'villa', page: 1 } });
    fireEvent.change(searchBox(), { target: { value: '   ' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS));
    expect(router.replace).toHaveBeenCalledWith('/proposals', { scroll: false });
  });

  test('an answer to an older search of ours never rewrites what is typed', () => {
    const register = show({ view: { query: '', page: 1 } });
    fireEvent.change(searchBox(), { target: { value: 'vi' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS));
    fireEvent.change(searchBox(), { target: { value: 'villa' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS));
    register.again({ view: { query: 'vi', page: 1 } });
    expect(searchBox().value).toBe('villa');
    register.again({ view: { query: 'villa', page: 1 } });
    expect(searchBox().value).toBe('villa');
    expect(router.replace).toHaveBeenCalledTimes(2);
  });

  test('a search that arrives another way (Back, a link) is adopted', () => {
    const register = show({ view: { query: 'villa', page: 1 } });
    register.again({ view: { query: 'tower', page: 1 } });
    expect(searchBox().value).toBe('tower');
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS));
    expect(router.replace).not.toHaveBeenCalled();
  });
});

// F1: a navigation started while a search is pausing or in flight has the last
// word, and the box always shows the search of the view that lands.
describe('ProposalsClient, a navigation overtaking a search', () => {
  test('A: the pager followed while a search is in flight lands with the box showing its search', () => {
    const register = show({ pager: pagerTo({ query: '', page: 2 }) });
    type('item');
    wait(SEARCH_PAUSE_MS + 50);
    expect(router.replace).toHaveBeenCalledWith('/proposals?q=item', { scroll: false });
    follow(screen.getByRole('link', { name: 'Next' }));
    expect(searchBox().value).toBe('');
    register.again({ view: { query: '', page: 2 } });
    expect(searchBox().value).toBe('');
    wait(SEARCH_PAUSE_MS * 3);
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  test('A: the pager followed while typing pauses cancels the search', () => {
    const register = show({ pager: pagerTo({ query: '', page: 2 }) });
    type('item');
    wait(100);
    follow(screen.getByRole('link', { name: 'Next' }));
    wait(SEARCH_PAUSE_MS * 3);
    expect(router.replace).not.toHaveBeenCalled();
    register.again({ view: { query: '', page: 2 } });
    expect(searchBox().value).toBe('');
  });

  test('A: a view landing with an unchanged search, not seen starting, still re-syncs the box', () => {
    const register = show();
    type('item');
    wait(SEARCH_PAUSE_MS);
    register.again({ view: { query: '', page: 2 } });
    expect(searchBox().value).toBe('');
  });

  test("B: Back while a search is in flight shows the Back view's search, even one unchanged", () => {
    const register = show({ view: { query: '', page: 2 } });
    type('item');
    wait(SEARCH_PAUSE_MS + 50);
    historyTo({ query: '', page: 1 });
    expect(searchBox().value).toBe('');
    register.again({ view: { query: '', page: 1 } });
    expect(searchBox().value).toBe('');
    wait(SEARCH_PAUSE_MS * 3);
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  test("B: Back while typing pauses cancels the search and shows the Back view's search", () => {
    const register = show({ view: { query: 'villa', page: 2 } });
    type('villa tower');
    wait(100);
    historyTo({ query: 'tile', page: 1 });
    expect(searchBox().value).toBe('tile');
    wait(SEARCH_PAUSE_MS * 3);
    expect(router.replace).not.toHaveBeenCalled();
    register.again({ view: { query: 'tile', page: 1 } });
    expect(searchBox().value).toBe('tile');
  });

  test('C: a row clicked while typing pauses opens the proposal: the pause sends nothing', () => {
    show();
    type('item');
    wait(100);
    follow(screen.getByRole('link', { name: /Q-/ }));
    wait(SEARCH_PAUSE_MS * 3);
    expect(router.replace).not.toHaveBeenCalled();
  });

  test('typing after a link was followed is the newest act: kept when the link lands, and sent', () => {
    const register = show({ pager: pagerTo({ query: '', page: 2 }) });
    follow(screen.getByRole('link', { name: 'Next' }));
    type('tile');
    register.again({ view: { query: '', page: 2 } });
    expect(searchBox().value).toBe('tile');
    wait(SEARCH_PAUSE_MS);
    expect(router.replace).toHaveBeenCalledWith('/proposals?q=tile', { scroll: false });
  });
});
