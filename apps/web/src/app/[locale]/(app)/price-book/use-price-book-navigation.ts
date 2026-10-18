'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import { priceBookViewSearch, type PriceBookView } from '@/lib/price-book/page-params';

/** How long typing rests before the search is sent: one request per pause, not per key. */
export const SEARCH_PAUSE_MS = 300;

export interface PriceBookNavigation {
  /** What the search box shows: what was typed, sent once typing pauses. */
  query: string;
  setQuery: (query: string) => void;
  setSectionId: (sectionId: string | null) => void;
  setActiveOnly: (activeOnly: boolean) => void;
  /** The page the server is loading; the table dims while it does. */
  pending: boolean;
}

/**
 * The price book's filters live in the URL (?q, ?section, ?active), so a link
 * opens the same view; changing one REPLACES the URL and starts again at page 1.
 * The server renders the new page inside a transition, so the old one stays on
 * screen (dimmed) instead of a skeleton while it loads.
 */
export function usePriceBookNavigation(view: PriceBookView): PriceBookNavigation {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(view.query);
  const sentQuery = useRef(view.query);
  const viewRef = useRef(view);
  const routerRef = useRef(router);
  useEffect(() => {
    viewRef.current = view;
    routerRef.current = router;
  });

  /** Show `change` applied to the current view, with what is typed, from page 1. */
  function show(change: Partial<PriceBookView>, typed: string): void {
    sentQuery.current = typed;
    const next = { ...viewRef.current, query: typed, page: 1, ...change };
    startTransition(() => routerRef.current.replace(`/price-book${priceBookViewSearch(next)}`, { scroll: false }));
  }

  // Back or forward to another search: the box follows the URL.
  useEffect(() => {
    if (view.query === sentQuery.current) return;
    sentQuery.current = view.query;
    setQuery(view.query);
  }, [view.query]);

  // `show` reads the router and the view through refs, so only typing re-arms the pause.
  useEffect(() => {
    if (query === sentQuery.current) return;
    const timer = setTimeout(() => show({}, query), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return {
    query,
    setQuery,
    setSectionId: (sectionId) => show({ sectionId }, query),
    setActiveOnly: (activeOnly) => show({ activeOnly }, query),
    pending,
  };
}
