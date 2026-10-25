'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import { loadCostEntries } from '@/lib/execution/costs/actions';
import {
  NO_COST_FILTER,
  type CostEntriesCursor,
  type CostEntriesFilter,
  type CostEntriesPage,
  type CostEntriesScope,
  type CostEntriesTotals,
} from '@/lib/execution/costs/types';

interface ListState {
  filter: CostEntriesFilter;
  /** Null until the first answer lands. */
  page: CostEntriesPage | null;
  /** How many pages of 50 are shown: what a reload asks for again. */
  pages: number;
}

type Asked = { ok: true; page: CostEntriesPage } | { ok: false; failure: ShownFailure };

/**
 * The costs list, asked of the server when it opens (never with the page
 * around it, so that page costs the same however many costs the contract
 * holds): a filter asks for its first page and its total, "show more" appends
 * the next 50, and `reload` asks again, after a write, for EVERY page shown,
 * one bounded page per request, so an entry edited on page 2 stays in view.
 * An answer that lands after a newer question is dropped; a failure keeps
 * what is shown and says why.
 */
export function useCostEntries(contractId: string) {
  const te = useTranslations('errors');
  const t = useTranslations('contracts.costs');
  const [list, setList] = useState<ListState>({ filter: NO_COST_FILTER, page: null, pages: 0 });
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);

  async function askPage(filter: CostEntriesFilter, cursor: CostEntriesCursor | null): Promise<Asked> {
    try {
      const result = await loadCostEntries({ contractId, filter, cursor });
      return result.ok && result.data ? { ok: true, page: result.data } : { ok: false, failure: result };
    } catch (rejection) {
      return { ok: false, failure: { rejection } };
    }
  }

  /** Ask `pages` pages from the top for `filter`, then show them in place of the list. */
  function askFromTop(filter: CostEntriesFilter, pages: number) {
    const asked = (latest.current += 1);
    startTransition(async () => {
      const entries: CostEntriesPage['entries'] = [];
      let totals: CostEntriesTotals | null = null;
      let scope: CostEntriesScope = 'own';
      let next: CostEntriesCursor | null = null;
      let read = 0;
      do {
        const answer = await askPage(filter, next);
        if (latest.current !== asked) return;
        if (!answer.ok) {
          setFailure(describeReadFailure(answer.failure, te, t('loadFailed')));
          return;
        }
        if (read === 0) ({ totals, scope } = answer.page);
        entries.push(...answer.page.entries);
        next = answer.page.next;
        read += 1;
      } while (read < pages && next !== null);
      setFailure(null);
      setList({ filter, page: { entries, next, totals, scope }, pages: read });
    });
  }

  function askNext() {
    const shown = list.page;
    if (!shown?.next) return;
    const asked = (latest.current += 1);
    const { filter } = list;
    const cursor = shown.next;
    startTransition(async () => {
      const answer = await askPage(filter, cursor);
      if (latest.current !== asked) return;
      if (!answer.ok) {
        setFailure(describeReadFailure(answer.failure, te, t('loadFailed')));
        return;
      }
      setFailure(null);
      setList((current) => ({
        filter,
        page: { entries: [...(current.page?.entries ?? []), ...answer.page.entries], next: answer.page.next, totals: current.page?.totals ?? null, scope: answer.page.scope },
        pages: current.pages + 1,
      }));
    });
  }

  const first = useRef(() => askFromTop(NO_COST_FILTER, 1));
  useEffect(() => first.current(), []);

  return {
    filter: list.filter,
    loaded: list.page !== null,
    entries: list.page?.entries ?? [],
    totals: list.page?.totals ?? null,
    /** Null until the first answer lands; 'own' is a member who sees only the costs it recorded. */
    scope: list.page?.scope ?? null,
    hasMore: (list.page?.next ?? null) !== null,
    pending,
    failure,
    applyFilter: (filter: CostEntriesFilter) => askFromTop(filter, 1),
    loadMore: askNext,
    reload: () => askFromTop(list.filter, Math.max(list.pages, 1)),
  };
}
