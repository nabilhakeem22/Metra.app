'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import { MAX_SEARCH_LENGTH, priceBookViewSearch, type PriceBookView } from '@/lib/price-book/page-params';
import { useHistoryMoves, useLinkFollows } from './price-book-location';

/** How long typing rests before the search is sent: one request per pause, not per key. */
export const SEARCH_PAUSE_MS = 300;
/**
 * A request of ours not rendered by then is asked once more, then given up for
 * the view on screen. The router sometimes drops a navigation outright (Back
 * landing while it was in flight, N3) and says nothing: no fetch, the old page
 * stays. Its end (isPending) is no sign either way, so only time tells; a
 * request asked again too early would race its own original answer.
 */
export const REQUEST_OVERDUE_MS = 6_000;

/** What the toolbar says: the search typed and the two filters chosen. */
type Filters = Pick<PriceBookView, 'query' | 'sectionId' | 'activeOnly'>;

export interface PriceBookNavigation extends Filters {
  /** The toolbar's view at page `page`: what a pager link opens, so a filter not yet answered is kept. */
  intendedView: (page: number) => PriceBookView;
  setQuery: (query: string) => void;
  setSectionId: (sectionId: string | null) => void;
  setActiveOnly: (activeOnly: boolean) => void;
  /** The page the server is loading; the table dims while it does. */
  pending: boolean;
}

const filtersOf = (view: PriceBookView): Filters => ({ query: view.query, sectionId: view.sectionId, activeOnly: view.activeOnly });

/** The URL search a filter state asks for: page 1, the search cut to what the server reads. */
const searchFor = (filters: Filters) =>
  priceBookViewSearch({ ...filters, query: filters.query.slice(0, MAX_SEARCH_LENGTH), page: 1 });

/**
 * The price book's filters live in the URL (?q, ?section, ?active), so a link
 * opens the same view; changing one REPLACES the URL and starts again at page 1,
 * inside a transition, so the old page stays on screen (dimmed) while it loads.
 *
 * WHO IS RIGHT, the toolbar or the view: the studio's NEWEST act.
 * - Typing, a filter: the toolbar. Until our latest request has RENDERED (the
 *   router can move the address bar before it has the page, so the bar proves
 *   nothing) what is typed and chosen is never rewritten, and any other view
 *   landing meanwhile, an older answer included, is ignored.
 * - Back or Forward: its target, adopted the moment the address bar moves, so a
 *   click after it builds on it (N3, N4); its view is then awaited.
 * - A link followed (the sidebar, the pager): the view it lands on.
 * - A request of ours the router never renders is asked once more after
 *   REQUEST_OVERDUE_MS, then given up: the view on screen, and its URL, win.
 */
export function usePriceBookNavigation(view: PriceBookView): PriceBookNavigation {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wanted, setWanted] = useState<Filters>(() => filtersOf(view));
  const wantedRef = useRef(wanted);
  /** What the URL says once our latest request renders. */
  const sent = useRef(searchFor(wanted));
  /** Our latest request not rendered yet. */
  const awaiting = useRef<string | null>(null);
  /** A Back or Forward whose view has not rendered yet. */
  const historyTarget = useRef<string | null>(null);
  const overdue = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const askedAgain = useRef(false);
  const arrived = priceBookViewSearch(view);
  const latest = useRef({ router, view, arrived });
  useEffect(() => {
    latest.current = { router, view, arrived };
  });
  useEffect(() => () => clearTimeout(overdue.current), []);

  function want(next: Filters): void {
    wantedRef.current = next;
    setWanted(next);
  }

  function go(search: string): void {
    startTransition(() => latest.current.router.replace(`/price-book${search}`, { scroll: false }));
  }

  /** Nothing of ours is awaited any more. */
  function forget(): void {
    clearTimeout(overdue.current);
    awaiting.current = null;
  }

  /** The toolbar shows `target`, and nothing of ours is awaited. */
  function settleOn(target: PriceBookView): void {
    forget();
    sent.current = searchFor(filtersOf(target));
    if (searchFor(wantedRef.current) !== sent.current) want(filtersOf(target));
  }

  /** Our request again, once: the router dropped it. */
  function askAgain(search: string): void {
    askedAgain.current = true;
    watch(search);
    go(search);
  }

  function watch(search: string): void {
    clearTimeout(overdue.current);
    overdue.current = setTimeout(() => {
      if (awaiting.current !== search) return;
      if (!askedAgain.current) {
        askAgain(search);
        return;
      }
      settleOn(latest.current.view);
      go(latest.current.arrived);
    }, REQUEST_OVERDUE_MS);
  }

  function send(filters: Filters): void {
    const search = searchFor(filters);
    if (search === sent.current) return;
    sent.current = search;
    awaiting.current = search;
    askedAgain.current = false;
    watch(search);
    go(search);
  }

  useHistoryMoves((target) => {
    const search = priceBookViewSearch(target);
    // Already on screen: nothing is left to render, so nothing to wait for.
    historyTarget.current = search === latest.current.arrived ? null : search;
    settleOn(target);
  });

  // A followed link carries what is typed (the pager) or replaces it (the sidebar): the pause sends nothing more.
  useLinkFollows(() => {
    forget();
    sent.current = searchFor(wantedRef.current);
  });

  useEffect(() => {
    if (arrived === historyTarget.current) historyTarget.current = null;
    if (view.page === 1 && arrived === awaiting.current) {
      forget();
      return;
    }
    const typingUnsent = searchFor(wantedRef.current) !== sent.current;
    if (typingUnsent || awaiting.current !== null || historyTarget.current !== null) return;
    settleOn(view);
  }, [arrived]); // `view` is read when its search changes: its fields are what `arrived` is made of.

  // Typing is sent once it pauses, with the filters chosen meanwhile (read when it fires).
  useEffect(() => {
    const timer = setTimeout(() => send(wantedRef.current), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [wanted.query]);

  return {
    ...wanted,
    intendedView: (page) => ({ ...wanted, query: wanted.query.slice(0, MAX_SEARCH_LENGTH), page }),
    setQuery: (query) => want({ ...wantedRef.current, query }),
    setSectionId: (sectionId) => {
      want({ ...wantedRef.current, sectionId });
      send(wantedRef.current);
    },
    setActiveOnly: (activeOnly) => {
      want({ ...wantedRef.current, activeOnly });
      send(wantedRef.current);
    },
    pending,
  };
}
