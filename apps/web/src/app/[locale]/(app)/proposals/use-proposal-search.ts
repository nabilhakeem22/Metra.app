'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import { registerSearchQuery, registerViewSearch } from '@/lib/registers/register-view';

/** How long typing rests before the search is sent: one request per pause, not per key. */
export const SEARCH_PAUSE_MS = 300;

export interface ProposalSearch {
  /** What the box shows. */
  typed: string;
  setTyped: (typed: string) => void;
  /** The server is loading the page a search asked for; the table dims while it does. */
  pending: boolean;
}

/**
 * The register's search lives in the URL (?q=), so the server searches every
 * proposal, not just the page on screen, and a link opens the same view.
 * Typing REPLACES the URL once it pauses, at page 1, inside a transition so the
 * old page stays on screen while the new one loads.
 *
 * The box is never rewritten by an answer to a search typed here (it may be an
 * older one landing after a newer was sent); a search that arrives any other way
 * (Back, a link) is adopted.
 */
export function useProposalSearch(arrivedQuery: string): ProposalSearch {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [typed, setTyped] = useState(arrivedQuery);
  /** The search the URL holds once the latest request renders. */
  const sent = useRef(arrivedQuery);
  /** Searches sent from here whose answer has not settled yet. */
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (inFlight.current.has(arrivedQuery)) {
      if (arrivedQuery === sent.current) inFlight.current.clear();
      return;
    }
    inFlight.current.clear();
    sent.current = arrivedQuery;
    setTyped(arrivedQuery);
  }, [arrivedQuery]);

  useEffect(() => {
    const query = registerSearchQuery(typed);
    if (query === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = query;
      inFlight.current.add(query);
      startTransition(() => router.replace(`/proposals${registerViewSearch({ query, page: 1 })}`, { scroll: false }));
    }, SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed, router]);

  return { typed, setTyped, pending };
}
