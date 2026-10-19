'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { searchForm } from '@/lib/search/fold';
import { searchPriceBookPicker } from '@/lib/price-book/picker-actions';
import type { PickerSearch } from '@/lib/price-book/picker-types';

/** How long typing rests before the picker asks the server: one request per pause. */
export const PICKER_PAUSE_MS = 200;
/** How long an answer is reused for the same search (reopening, or typing back to it). */
export const PICKER_ANSWER_MS = 60_000;

export interface PriceBookSearchState {
  /** The latest answer: kept on screen while the next one loads. */
  search: PickerSearch | null;
  /** The answer on screen is not for what is typed now (the next one is on its way): Enter picks nothing. */
  stale: boolean;
  /** Why the last ask failed, in the page's language; null when it did not. */
  failure: string | null;
}

interface Answered {
  key: string;
  search: PickerSearch | null;
  failure: string | null;
}

/**
 * The picker's items, asked of the server ON DEMAND while it is open: the first
 * ones on opening, the matches of what is typed after each pause. Answers are
 * kept per search (as searchForm folds it, so «بولى» and «بولي» are one search)
 * for PICKER_ANSWER_MS; an answer that arrives after a newer question is dropped.
 */
export function usePriceBookSearch(open: boolean, query: string, locale: string): PriceBookSearchState {
  const te = useTranslations('errors');
  // Read when an answer lands, so a new translator never re-asks the server.
  const translate = useRef(te);
  useEffect(() => {
    translate.current = te;
  });
  const answers = useRef(new Map<string, { search: PickerSearch; at: number }>());
  const latestAsked = useRef('');
  const [answered, setAnswered] = useState<Answered>({ key: '', search: null, failure: null });
  const folded = searchForm(query);
  const key = `${locale}|${folded}`;

  useEffect(() => {
    if (!open) return;
    latestAsked.current = key;
    const kept = answers.current.get(key);
    if (kept && Date.now() - kept.at < PICKER_ANSWER_MS) {
      setAnswered({ key, search: kept.search, failure: null });
      return;
    }
    const settle = (search: PickerSearch | null, failure: string | null) => {
      if (latestAsked.current === key) setAnswered({ key, search, failure });
    };
    const ask = () =>
      searchPriceBookPicker(folded, locale).then(
        (result) => {
          if (result.ok && result.data) {
            answers.current.set(key, { search: result.data, at: Date.now() });
            settle(result.data, null);
          } else {
            settle(null, describeFailure(result, translate.current));
          }
        },
        (rejection: unknown) => settle(null, describeRejection(rejection, translate.current)),
      );
    const timer = setTimeout(ask, folded === '' ? 0 : PICKER_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [open, key, folded, locale]);

  const stale = answered.key !== key;
  return {
    search: answered.search,
    stale,
    failure: stale ? null : answered.failure,
  };
}
