'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** The in-app destination of a plain left click on a link, or null to let it be. */
export function inAppLinkTarget(event: MouseEvent, here: Location): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href, here.href);
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return url;
}

/**
 * While `active`, a click on a link to another page of the app does not leave at
 * once: `beforeLeave` runs first (save, or ask), and the page is left only when
 * it answers true. Closing the tab is the browser's own prompt
 * (useUnsavedChangesPrompt); this covers the sidebar, breadcrumbs and every other
 * in-app link, and the browser's Back and Forward, none of which fire
 * `beforeunload`.
 *
 * The listener runs in the CAPTURE phase on the document, so it decides before
 * Next's Link handler (on the React root, further in) ever sees the click.
 */
export function useInAppLeaveGuard(input: {
  active: boolean;
  beforeLeave: () => Promise<boolean>;
}): void {
  const router = useRouter();
  const beforeLeave = useRef(input.beforeLeave);
  useEffect(() => {
    beforeLeave.current = input.beforeLeave;
  });

  useEffect(() => {
    if (!input.active) return;
    const onClick = (event: MouseEvent) => {
      const target = inAppLinkTarget(event, window.location);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      void beforeLeave.current().then((leave) => {
        if (leave) router.push(`${target.pathname}${target.search}${target.hash}`);
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [input.active, router]);

  // Back and Forward. The browser has already moved the URL when `popstate`
  // fires, so the guard runs in the CAPTURE phase (before Next's own listener,
  // which it stops), puts this page's entry back, and leaves for where the user
  // was going only once `beforeLeave` agrees.
  useEffect(() => {
    if (!input.active) return;
    const pageUrl = window.location.href;
    const pageEntry: unknown = window.history.state;
    const samePage = (href: string) => href.split('#')[0] === pageUrl.split('#')[0];
    const onPopState = (event: PopStateEvent) => {
      const destination = new URL(window.location.href);
      if (samePage(destination.href)) return;
      event.stopImmediatePropagation();
      window.history.pushState(pageEntry, '', pageUrl);
      void beforeLeave.current().then((leave) => {
        if (leave) router.push(`${destination.pathname}${destination.search}${destination.hash}`);
      });
    };
    window.addEventListener('popstate', onPopState, true);
    return () => window.removeEventListener('popstate', onPopState, true);
  }, [input.active, router]);
}
