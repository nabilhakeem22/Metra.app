'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import { loadCostEntries } from '@/lib/execution/costs/actions';
import { NO_COST_FILTER, type CostEntriesFilter, type CostEntriesPage } from '@/lib/execution/costs/types';

interface ListState {
  filter: CostEntriesFilter;
  page: CostEntriesPage;
}

/**
 * The Costs tab's list: the first page the server rendered, a filter asked of
 * the server (its first page and its totals), and "show more" appending the
 * next 50. After any write the page re-renders with a new first page, shown
 * unfiltered (the new entry on top). An answer that lands after a newer
 * question is dropped; a failure keeps what is shown and says why.
 */
export function useCostEntries(contractId: string, initial: CostEntriesPage) {
  const te = useTranslations('errors');
  const t = useTranslations('contracts.costs');
  const [list, setList] = useState<ListState>({ filter: NO_COST_FILTER, page: initial });
  const [shownInitial, setShownInitial] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);

  if (shownInitial !== initial) {
    setShownInitial(initial);
    setList({ filter: NO_COST_FILTER, page: initial });
    setFailure(null);
  }

  function ask(filter: CostEntriesFilter, append: boolean) {
    const asked = (latest.current += 1);
    const cursor = append ? list.page.next : null;
    const fail = (shown: ShownFailure) => latest.current === asked && setFailure(describeReadFailure(shown, te, t('loadFailed')));
    startTransition(async () => {
      try {
        const result = await loadCostEntries({ contractId, filter, cursor });
        if (latest.current !== asked) return;
        if (!result.ok || !result.data) {
          fail(result);
          return;
        }
        const answer = result.data;
        setFailure(null);
        setList((current) =>
          append
            ? { filter, page: { entries: [...current.page.entries, ...answer.entries], next: answer.next, totals: current.page.totals } }
            : { filter, page: answer },
        );
      } catch (rejection) {
        fail({ rejection });
      }
    });
  }

  return {
    filter: list.filter,
    entries: list.page.entries,
    totals: list.page.totals,
    hasMore: list.page.next !== null,
    pending,
    failure,
    applyFilter: (filter: CostEntriesFilter) => ask(filter, false),
    loadMore: () => ask(list.filter, true),
  };
}
