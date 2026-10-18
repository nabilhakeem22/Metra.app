'use client';

import { useEffect, useRef } from 'react';
import { readPriceBookView, type PriceBookView } from '@/lib/price-book/page-params';

// The two navigations the price book did not start, seen the moment they
// happen (before the router has rendered anything): Back/Forward and a link.

/** The view the address bar names now, as the page would read it. */
function locationView(): PriceBookView {
  const params = new URLSearchParams(window.location.search);
  return readPriceBookView(Object.fromEntries([...params.keys()].map((key) => [key, params.get(key) ?? undefined])));
}

/** Keeps the latest callback in a ref, so a listener registered once calls it. */
function useLatest<T>(value: T) {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  return latest;
}

/** Calls `onMove` with the view the address bar names the moment Back or Forward moves it (popstate). */
export function useHistoryMoves(onMove: (target: PriceBookView) => void): void {
  const latest = useLatest(onMove);
  useEffect(() => {
    const moved = () => latest.current(locationView());
    window.addEventListener('popstate', moved);
    return () => window.removeEventListener('popstate', moved);
  }, [latest]);
}

/** Calls `onFollow` when a link in the page is followed here (a plain click, not a new tab). */
export function useLinkFollows(onFollow: () => void): void {
  const latest = useLatest(onFollow);
  useEffect(() => {
    const clicked = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (link && link.getAttribute('target') !== '_blank') latest.current();
    };
    document.addEventListener('click', clicked, true);
    return () => document.removeEventListener('click', clicked, true);
  }, [latest]);
}
