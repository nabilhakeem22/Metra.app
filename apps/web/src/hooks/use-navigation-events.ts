'use client';

import { useEffect, useRef } from 'react';

// The two navigations a page with its view in the URL did not start, seen the
// moment they happen (before the router has rendered anything): Back/Forward
// and a link followed. The price book and the proposals register both listen.

/** Keeps the latest callback in a ref, so a listener registered once calls it. */
function useLatest<T>(value: T) {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  return latest;
}

/** Calls `onMove` the moment Back or Forward moves the address bar (popstate); `window.location` is the target. */
export function useHistoryMoves(onMove: () => void): void {
  const latest = useLatest(onMove);
  useEffect(() => {
    const moved = () => latest.current();
    window.addEventListener('popstate', moved);
    return () => window.removeEventListener('popstate', moved);
  }, [latest]);
}

/** Where a followed link leads, or null when its href does not read as a URL. */
function linkTarget(link: Element): URL | null {
  try {
    return new URL(link.getAttribute('href') ?? '', window.location.href);
  } catch {
    return null;
  }
}

/**
 * Calls `onFollow` with where a link in the page leads when it is followed here
 * (a plain click, not a new tab). It listens in the CAPTURE phase, so it runs
 * before Next's Link starts the navigation.
 */
export function useLinkFollows(onFollow: (target: URL | null) => void): void {
  const latest = useLatest(onFollow);
  useEffect(() => {
    const clicked = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (link && link.getAttribute('target') !== '_blank') latest.current(linkTarget(link));
    };
    document.addEventListener('click', clicked, true);
    return () => document.removeEventListener('click', clicked, true);
  }, [latest]);
}
