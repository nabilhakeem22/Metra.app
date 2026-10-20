'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import { loadCostEntries } from '@/lib/execution/costs/actions';
import { NO_COST_FILTER, type CostEntriesFilter, type CostEntriesPage } from '@/lib/execution/costs/types';

interface ListState {
  filter: CostEntriesFilter;
  /** Null until the first answer lands. */
  page: CostEntriesPage | null;
}

/**
 * The Costs tab's list, asked of the server when the tab opens (never with
 * the contract page, so the page costs the same however many costs the
 * contract holds): a filter asks for its first page and its total, "show
 * more" appends the next 50, and `reload` asks the current filter again after
 * a write. An answer that lands after a newer question is dropped; a failure
 * keeps what is shown and says why.
 */
export function useCostEntries(contractId: string) {
  const te = useTranslations('errors');
  const t = useTranslations('contracts.costs');
  const [list, setList] = useState<ListState>({ filter: NO_COST_FILTER, page: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);

  function ask(filter: CostEntriesFilter, append: boolean) {
    const asked = (latest.current += 1);
    const shown = list.page;
    const cursor = append && shown ? shown.next : null;
    const fail = (refusal: ShownFailure) => latest.current === asked && setFailure(describeReadFailure(refusal, te, t('loadFailed')));
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
          append && current.page
            ? { filter, page: { entries: [...current.page.entries, ...answer.entries], next: answer.next, totals: current.page.totals } }
            : { filter, page: answer },
        );
      } catch (rejection) {
        fail({ rejection });
      }
    });
  }

  const first = useRef(() => ask(NO_COST_FILTER, false));
  useEffect(() => first.current(), []);

  return {
    filter: list.filter,
    loaded: list.page !== null,
    entries: list.page?.entries ?? [],
    totals: list.page?.totals ?? null,
    hasMore: (list.page?.next ?? null) !== null,
    pending,
    failure,
    applyFilter: (filter: CostEntriesFilter) => ask(filter, false),
    loadMore: () => ask(list.filter, true),
    reload: () => ask(list.filter, false),
  };
}
