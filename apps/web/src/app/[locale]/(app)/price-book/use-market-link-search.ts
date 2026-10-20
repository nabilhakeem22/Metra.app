'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import { searchMarketLinks } from '@/lib/market-book/actions';
import type { MarketLinkSearch } from '@/lib/market-book/types';

/** How long typing rests before the server is asked: one request per pause. */
const SEARCH_PAUSE_MS = 200;

interface Answer {
  query: string;
  search: MarketLinkSearch | null;
  failure: string | null;
}

/**
 * The market items the link combobox offers for what is typed, asked of the
 * server after each pause (the first ones while nothing is typed). An answer
 * that lands after a newer question is dropped; a failure says why under the
 * search box and keeps nothing stale on offer.
 */
export function useMarketLinkSearch(costItemId: string, query: string) {
  const te = useTranslations('errors');
  const t = useTranslations('priceBook.market.link');
  // Read when an answer lands, so a new translator never re-asks the server.
  const describe = useRef((failure: ShownFailure) => describeReadFailure(failure, te, t('loadFailed')));
  useEffect(() => {
    describe.current = (failure) => describeReadFailure(failure, te, t('loadFailed'));
  });
  const latestAsked = useRef<string | null>(null);
  const [answer, setAnswer] = useState<Answer>({ query: '', search: null, failure: null });

  useEffect(() => {
    latestAsked.current = query;
    const settle = (next: Answer) => latestAsked.current === query && setAnswer(next);
    const failed = (failure: ShownFailure) => settle({ query, search: null, failure: describe.current(failure) });
    const ask = () =>
      searchMarketLinks({ costItemId, query }).then(
        (result) => (result.ok && result.data ? settle({ query, search: result.data, failure: null }) : failed(result)),
        (rejection: unknown) => failed({ rejection }),
      );
    const timer = setTimeout(ask, query.trim() === '' ? 0 : SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [costItemId, query]);

  const current = answer.query === query;
  return {
    items: current ? (answer.search?.items ?? []) : [],
    more: current && (answer.search?.more ?? false),
    answered: current && answer.search !== null,
    failure: current ? answer.failure : null,
  };
}
