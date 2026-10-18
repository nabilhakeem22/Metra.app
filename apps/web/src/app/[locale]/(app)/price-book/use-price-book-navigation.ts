'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import { MAX_SEARCH_LENGTH, priceBookViewSearch, type PriceBookView } from '@/lib/price-book/page-params';

/** How long typing rests before the search is sent: one request per pause, not per key. */
export const SEARCH_PAUSE_MS = 300;

/** What the toolbar says: the search typed and the two filters chosen. */
type Filters = Pick<PriceBookView, 'query' | 'sectionId' | 'activeOnly'>;

export interface PriceBookNavigation extends Filters {
  /** The toolbar's view at page `page`: what a pager link opens, so a filter not yet answered is kept. */
  intendedView: (page: number) => PriceBookView;
  /** A pager link is being followed: what is typed travels in its URL, so the pause sends nothing more. */
  flush: () => void;
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
 * WHO IS RIGHT, the toolbar or the view the server sent:
 * - While a request of ours is in flight (typing not yet sent, or a request
 *   sent and its view not yet landed) the toolbar is: what is typed and chosen
 *   is never rewritten, and every request is built from it, never from the
 *   last page the server sent. An older answer landing meanwhile is ignored;
 *   the newer one will land and match.
 * - With nothing of ours in flight, the view is: any view that differs from the
 *   toolbar (back or forward, the sidebar link, a pager link) is adopted.
 */
export function usePriceBookNavigation(view: PriceBookView): PriceBookNavigation {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wanted, setWanted] = useState<Filters>(() => filtersOf(view));
  const wantedRef = useRef(wanted);
  /** What the URL says once our latest request lands. */
  const sent = useRef(searchFor(wanted));
  /** Our latest request whose view has not landed yet, and every request sent since the last one landed. */
  const awaiting = useRef<string | null>(null);
  const unanswered = useRef<string[]>([]);
  const routerRef = useRef(router);
  const pendingRef = useRef(pending);
  // Declared before the arrival effect, so it reads this commit's values.
  useEffect(() => {
    routerRef.current = router;
    pendingRef.current = pending;
  });

  function want(next: Filters): void {
    wantedRef.current = next;
    setWanted(next);
  }

  function send(filters: Filters): void {
    const search = searchFor(filters);
    if (search === sent.current) return;
    sent.current = search;
    awaiting.current = search;
    unanswered.current = [...unanswered.current, search];
    startTransition(() => routerRef.current.replace(`/price-book${search}`, { scroll: false }));
  }

  const arrived = priceBookViewSearch(view);
  useEffect(() => {
    const isPageOne = view.page === 1;
    if (isPageOne && arrived === awaiting.current) {
      awaiting.current = null;
      unanswered.current = [];
      return;
    }
    const typingUnsent = searchFor(wantedRef.current) !== sent.current;
    const olderAnswer = awaiting.current !== null && isPageOne && unanswered.current.includes(arrived);
    const requestInFlight = awaiting.current !== null && pendingRef.current;
    if (typingUnsent || olderAnswer || requestInFlight) return;
    awaiting.current = null;
    unanswered.current = [];
    const landed = filtersOf(view);
    sent.current = searchFor(landed);
    if (searchFor(wantedRef.current) !== sent.current) want(landed);
  }, [arrived]); // `view` is read when its search changes: its fields are what `arrived` is made of.

  // Typing is sent once it pauses, with the filters chosen meanwhile (read when it fires).
  useEffect(() => {
    const timer = setTimeout(() => send(wantedRef.current), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [wanted.query]);

  return {
    ...wanted,
    intendedView: (page) => ({ ...wanted, query: wanted.query.slice(0, MAX_SEARCH_LENGTH), page }),
    flush: () => {
      sent.current = searchFor(wantedRef.current);
    },
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
