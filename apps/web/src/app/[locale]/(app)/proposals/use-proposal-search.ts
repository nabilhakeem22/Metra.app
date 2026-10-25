'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useHistoryMoves, useLinkFollows } from '@/hooks/use-navigation-events';
import { useRouter } from '@/i18n/routing';
import {
  readRegisterView,
  registerSearchQuery,
  registerViewSearch,
  type RegisterView,
} from '@/lib/registers/register-view';

/** How long typing rests before the search is sent: one request per pause, not per key. */
export const SEARCH_PAUSE_MS = 300;

export interface ProposalSearch {
  /** What the box shows. */
  typed: string;
  setTyped: (typed: string) => void;
  /** The server is loading the page a search asked for; the table dims while it does. */
  pending: boolean;
}

/** The search a URL holds, read as the page reads it (the first ?q= wins). */
function queryAt(url: URL | Location): string {
  return readRegisterView({ q: new URLSearchParams(url.search).get('q') ?? undefined }).query;
}

/**
 * The register's search lives in the URL (?q=), so the server searches every
 * proposal, not just the page on screen, and a link opens the same view.
 * Typing REPLACES the URL once it pauses, at page 1, inside a transition so the
 * old page stays on screen while the new one loads.
 *
 * WHO IS RIGHT, the box or the URL: the studio's NEWEST act.
 * - Typing: the box. An answer to a search typed here (it may be an older one
 *   landing after a newer was sent) never rewrites it.
 * - Back or Forward, a link followed (the pager, a row, the sidebar): the moment
 *   it starts, typing not sent yet is dropped and nothing sent from here is
 *   awaited, so the pause can never override it; Back, Forward or a link to this
 *   register shows the search it leads to in the box at once.
 * - Any other view landing (a navigation not seen starting): its search, unless
 *   typing after it is still to be sent.
 */
export function useProposalSearch(arrived: RegisterView): ProposalSearch {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [typed, setTyped] = useState(arrived.query);
  /** The search the URL holds once the latest request renders. */
  const sent = useRef(arrived.query);
  /** Searches sent from here whose answer has not landed yet. */
  const inFlight = useRef(new Set<string>());
  /** Typing waiting out its pause, not sent yet. */
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** This register's path as the address bar shows it (locale prefixed). */
  const registerPath = useRef('');

  /** Another navigation has the last word: typing not sent yet is dropped, and nothing sent from here is awaited. */
  function yieldToNavigation(): void {
    clearTimeout(pause.current);
    pause.current = undefined;
    inFlight.current.clear();
  }

  /** The box shows `query`, the search the URL holds. */
  function adopt(query: string): void {
    yieldToNavigation();
    sent.current = query;
    setTyped(query);
  }

  useHistoryMoves(() => {
    if (window.location.pathname === registerPath.current) adopt(queryAt(window.location));
    else yieldToNavigation();
  });

  useLinkFollows((target) => {
    const here = window.location;
    if (target && target.origin === here.origin && target.pathname === here.pathname) adopt(queryAt(target));
    else yieldToNavigation();
  });

  const arrivedSearch = registerViewSearch(arrived);
  useEffect(() => {
    registerPath.current = window.location.pathname;
    if (arrived.page === 1 && inFlight.current.has(arrived.query)) {
      if (arrived.query === sent.current) inFlight.current.clear();
      return;
    }
    if (pause.current !== undefined) return;
    adopt(arrived.query);
  }, [arrivedSearch]); // `arrived` is read when its search changes: its fields are what `arrivedSearch` is made of.

  useEffect(() => {
    const query = registerSearchQuery(typed);
    if (query === sent.current) return;
    pause.current = setTimeout(() => {
      pause.current = undefined;
      sent.current = query;
      inFlight.current.add(query);
      startTransition(() => router.replace(`/proposals${registerViewSearch({ query, page: 1 })}`, { scroll: false }));
    }, SEARCH_PAUSE_MS);
    return () => {
      clearTimeout(pause.current);
      pause.current = undefined;
    };
  }, [typed, router]);

  return { typed, setTyped, pending };
}
