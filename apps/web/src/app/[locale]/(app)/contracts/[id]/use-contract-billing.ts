'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { loadContractBilling, loadContractPayments } from '@/lib/execution/billing/actions';
import type { ContractBillingView } from '@/lib/execution/billing/view';

/** The Payments tab's data, held BY THE TAB: it is read again every time the tab is shown. */
export interface ContractBilling {
  /** Null until the first read of this showing. */
  view: ContractBillingView | null;
  /** What the last read or "show more" was refused with, said above the tab. */
  error: string | null;
  loading: boolean;
  /** Read the whole tab again: the view it read, or null when the read failed. */
  reload: () => Promise<ContractBillingView | null>;
  /** Show the view a write answered with (after-write.ts), instead of reading again. */
  apply: (view: ContractBillingView) => void;
  /** The ledger's next 50 rows, after the ones shown. */
  showMorePayments: () => Promise<void>;
}

/**
 * The tab is ALWAYS read on demand, through its action, never rendered with
 * the page, even when the page opens on it (a link from the delivery card):
 * up to 100 requests and 50 payments rendered by the server made the page 26%
 * heavier on the Worker with 60 requests and 500 payments (A4 workerd
 * measurement), while the read alone grows 9%. The rows render in the browser.
 *
 * Never shown stale (A4 F1, F3): the tab mounts each time it is shown and reads
 * itself then; a write that worked answers with the fresh view; a write that
 * failed, or whose answer never came, is followed by a read. Either way the
 * ledger is back on its first page.
 */
export function useContractBilling(contractId: string): ContractBilling {
  const te = useTranslations('errors');
  const [view, setView] = useState<ContractBillingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await loadContractBilling({ contractId });
      if (res.ok && res.data) {
        setView(res.data);
        return res.data;
      }
      setError(describeFailure(res, te));
    } catch (rejection) {
      setError(describeRejection(rejection, te));
    } finally {
      setLoading(false);
    }
    return null;
  }, [contractId, te]);

  const apply = useCallback((next: ContractBillingView) => {
    setError(null);
    setView(next);
  }, []);

  const showMorePayments = useCallback(async () => {
    const cursor = view?.payments.nextCursor;
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const res = await loadContractPayments({ contractId, cursor });
      if (res.ok && res.data) {
        const next = res.data;
        setView((current) => current && {
          ...current,
          payments: { rows: [...current.payments.rows, ...next.rows], nextCursor: next.nextCursor },
        });
      } else {
        setError(describeFailure(res, te));
      }
    } catch (rejection) {
      setError(describeRejection(rejection, te));
    } finally {
      setLoading(false);
    }
  }, [contractId, te, view?.payments.nextCursor]);

  return { view, error, loading, reload, apply, showMorePayments };
}
