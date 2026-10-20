'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { loadContractBilling, loadContractPayments } from '@/lib/execution/billing/actions';
import type { ContractBillingView } from '@/lib/execution/billing/view';

/** The Payments tab's data, held by the contract detail client ABOVE the tab switch. */
export interface ContractBilling {
  /** Null until the first read: the page opened on another tab. */
  view: ContractBillingView | null;
  /** What the last read or "show more" was refused with, said above the tab. */
  error: string | null;
  loading: boolean;
  /** Read the whole tab again: when it is first shown, and after each change it makes. */
  reload: () => Promise<void>;
  /** The ledger's next 50 rows, after the ones shown. */
  showMorePayments: () => Promise<void>;
}

/**
 * The tab is ALWAYS read on demand, through its action, never rendered with
 * the page, even when the page opens on it (a link from the delivery card):
 * up to 100 requests and 50 payments rendered by the server made the page 26%
 * heavier on the Worker with 60 requests and 500 payments (A4 workerd
 * measurement), while the read alone grows 9%. The rows render in the browser.
 * Every change the tab makes reloads it, which also brings the ledger back to
 * its first page.
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
      if (res.ok && res.data) setView(res.data);
      else setError(describeFailure(res, te));
    } catch (rejection) {
      setError(describeRejection(rejection, te));
    } finally {
      setLoading(false);
    }
  }, [contractId, te]);

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

  return { view, error, loading, reload, showMorePayments };
}
