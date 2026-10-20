'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import { loadFinalAccount, loadFinalAccountDifferences } from '@/lib/execution/final-account/actions';
import type { FinalAccountView } from '@/lib/execution/final-account/load';

export interface FinalAccountData {
  /** Null until the first read of this showing. */
  view: FinalAccountView | null;
  error: string | null;
  loading: boolean;
  /** Read the whole card again: the view it read, or null when the read failed. */
  reload: () => Promise<FinalAccountView | null>;
  /** Show the view an issue answered with, instead of reading again. */
  apply: (view: FinalAccountView) => void;
  /** The next 50 measured differences. */
  showMoreDifferences: () => Promise<void>;
}

/**
 * The final account card's data, held BY THE CARD and read on demand through
 * its action every time its tab is shown, never rendered with the page: the
 * figures are SQL aggregates and the differences one page of 50, so the read
 * costs the same however many lines were measured.
 */
export function useFinalAccount(contractId: string): FinalAccountData {
  const te = useTranslations('errors');
  const [view, setView] = useState<FinalAccountView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async <T,>(read: () => Promise<ActionResult & { data?: T }>, show: (data: T) => void): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const res = await read();
        if (res.ok && res.data) {
          show(res.data);
          return res.data;
        }
        setError(describeFailure(res, te));
      } catch (rejection) {
        setError(describeRejection(rejection, te));
      } finally {
        setLoading(false);
      }
      return null;
    },
    [te],
  );

  const reload = useCallback(() => run(() => loadFinalAccount({ contractId }), setView), [contractId, run]);

  const apply = useCallback((next: FinalAccountView) => {
    setError(null);
    setView(next);
  }, []);

  const afterLineId = view?.differences.nextCursor ?? null;
  const showMoreDifferences = useCallback(async () => {
    if (!afterLineId) return;
    await run(
      () => loadFinalAccountDifferences({ contractId, afterLineId }),
      (page) =>
        setView((current) => current && {
          ...current,
          differences: { rows: [...current.differences.rows, ...page.rows], nextCursor: page.nextCursor },
        }),
    );
  }, [afterLineId, contractId, run]);

  return { view, error, loading, reload, apply, showMoreDifferences };
}
