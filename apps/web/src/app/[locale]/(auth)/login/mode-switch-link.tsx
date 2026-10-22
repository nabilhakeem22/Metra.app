'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Link } from '@/i18n/routing';

/** A plain left click: the one the page handles itself. A modified click opens a tab as usual. */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The link between sign-in and create-account. Both are the same static page
 * with another `?mode`, so a plain click only rewrites the address in place
 * (`history.replaceState`, which `useSearchParams` follows) and the framing
 * swaps: nothing is fetched, the form stays mounted, and what was typed stays.
 * The href is the real page, for a new tab or a browser without JavaScript.
 * No prefetch: the click never navigates.
 */
export function ModeSwitchLink({
  mode,
  className,
  children,
}: {
  mode: 'signin' | 'signup';
  className?: string;
  children: ReactNode;
}) {
  function switchInPlace(event: MouseEvent<HTMLAnchorElement>): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    window.history.replaceState(null, '', event.currentTarget.href);
  }

  return (
    <Link href={{ pathname: '/login', query: { mode } }} prefetch={false} onClick={switchInPlace} className={className}>
      {children}
    </Link>
  );
}
