'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import { MAX_SEARCH_LENGTH, priceBookViewSearch, type PriceBookView } from '@/lib/price-book/page-params';

/** How long typing rests before the search is sent: one request per pause, not per key. */
export const SEARCH_PAUSE_MS = 300;
/** How many of our own requests are remembered, to tell their answers from a navigation elsewhere. */
const REMEMBERED_REQUESTS = 50;

/** What the toolbar says: the search typed and the two filters chosen. */
type Filters = Pick<PriceBookView, 'query' | 'sectionId' | 'activeOnly'>;

export interface PriceBookNavigation extends Filters {
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
 * What the studio typed and chose is AUTHORITATIVE: the box, the select and the
 * checkbox move at once and are never rewritten by the answer to one of our own
 * requests (an older, slower answer landing after a newer request must not undo
 * typing). Each request is built from that intended state, never from the last
 * page the server sent. Only a view that is NOT one of our requests (back or
 * forward, a pager link, a link) is adopted by the toolbar.
 */
export function usePriceBookNavigation(view: PriceBookView): PriceBookNavigation {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wanted, setWanted] = useState<Filters>(() => filtersOf(view));
  const wantedRef = useRef(wanted);
  const sent = useRef(searchFor(wanted));
  const requested = useRef<string[]>([]);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  function want(next: Filters): void {
    wantedRef.current = next;
    setWanted(next);
  }

  function send(filters: Filters): void {
    const search = searchFor(filters);
    if (search === sent.current) return;
    sent.current = search;
    requested.current = [...requested.current.slice(1 - REMEMBERED_REQUESTS), search];
    startTransition(() => routerRef.current.replace(`/price-book${search}`, { scroll: false }));
  }

  const arrived = priceBookViewSearch(view);
  useEffect(() => {
    if (view.page === 1 && requested.current.includes(arrived)) return;
    requested.current = [];
    sent.current = searchFor(filtersOf(view));
    const current = wantedRef.current;
    if (current.query !== view.query || current.sectionId !== view.sectionId || current.activeOnly !== view.activeOnly) {
      want(filtersOf(view));
    }
  }, [arrived]); // `view` is read when its search changes: its fields are what `arrived` is made of.

  // Typing is sent once it pauses, with the filters chosen meanwhile (read when it fires).
  useEffect(() => {
    const timer = setTimeout(() => send(wantedRef.current), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [wanted.query]);

  return {
    ...wanted,
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
