import { act, fireEvent, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProposalListRow } from '@/lib/proposals/queries';
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
  query: '',
  canManage: true,
  hasClients: true,
  pager: <nav aria-label="the pager" />,
};

function show(props: Partial<ProposalsClientProps> = {}) {
  const view = renderWithIntl(<ProposalsClient {...BASE} {...props} />, { locale: 'en' });
  /** The same page rendered again by the server, as a navigation does. */
  const again = (next: Partial<ProposalsClientProps>) =>
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="UTC">
        <ProposalsClient {...BASE} {...props} {...next} />
      </NextIntlClientProvider>,
    );
  return { again };
}

const searchBox = () => screen.getByPlaceholderText(messageAt('en', 'proposals.search')) as HTMLInputElement;

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
    show({ items: [], query: 'nothing like this' });
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
    show({ query: '' });
    fireEvent.change(searchBox(), { target: { value: 'v' } });
    fireEvent.change(searchBox(), { target: { value: 'vil' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS - 1));
    expect(router.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/proposals?q=vil', { scroll: false });
  });

  test('clearing the box shows every proposal again; blanks are no search', () => {
    show({ query: 'villa' });
    fireEvent.change(searchBox(), { target: { value: '   ' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS));
    expect(router.replace).toHaveBeenCalledWith('/proposals', { scroll: false });
  });

  test('an answer to an older search of ours never rewrites what is typed', () => {
    const view = show({ query: '' });
    fireEvent.change(searchBox(), { target: { value: 'vi' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS));
    fireEvent.change(searchBox(), { target: { value: 'villa' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS));
    view.again({ query: 'vi' });
    expect(searchBox().value).toBe('villa');
    view.again({ query: 'villa' });
    expect(searchBox().value).toBe('villa');
    expect(router.replace).toHaveBeenCalledTimes(2);
  });

  test('a search that arrives another way (Back, a link) is adopted', () => {
    const view = show({ query: 'villa' });
    view.again({ query: 'tower' });
    expect(searchBox().value).toBe('tower');
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS));
    expect(router.replace).not.toHaveBeenCalled();
  });
});
