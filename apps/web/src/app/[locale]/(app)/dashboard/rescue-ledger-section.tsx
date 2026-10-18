'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { RangeMonths } from '@/lib/dashboard/range';
import type { RescueLedger, RescueLedgerResponse } from '@/lib/dashboard/rescue-ledger/types';
import { RescueLedgerView } from './rescue-ledger-view';

/** The ledger's own route: a separate Worker request, so the dashboard render does none of this work. */
const RESCUE_LEDGER_PATH = '/api/dashboard/rescue-ledger';

type LedgerState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'withheld' }
  | { status: 'ready'; ledger: RescueLedger };

/** One GET, never cached; any answer that is not the ledger is a failure, except a refusal. */
async function fetchLedger(range: RangeMonths, signal: AbortSignal): Promise<LedgerState> {
  const response = await fetch(`${RESCUE_LEDGER_PATH}?range=${range}`, { credentials: 'same-origin', cache: 'no-store', signal });
  if (response.status === 403) return { status: 'withheld' };
  const body = (await response.json()) as RescueLedgerResponse;
  return body.ok ? { status: 'ready', ledger: body.ledger } : { status: 'failed' };
}

/**
 * The rescue ledger island: fetches on mount (and on a retry), shows a skeleton
 * of the block's own height meanwhile, and on a failure says so with a retry
 * while the rest of the dashboard stays as it is. A refusal (the studio limited
 * firm figures after the page rendered) renders nothing, like the firm block.
 */
export function RescueLedgerSection({ range }: { range: RangeMonths }) {
  const t = useTranslations('dashboard.rescue');
  const locale = useLocale();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LedgerState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchLedger(range, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'failed' });
      });
    return () => controller.abort();
  }, [range, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  if (state.status === 'withheld') return null;
  if (state.status === 'ready') return <RescueLedgerView ledger={state.ledger} locale={locale} />;
  if (state.status === 'failed') {
    return (
      <Card role="alert">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-body text-muted-foreground">{t('loadFailed')}</p>
          <Button variant="secondary" onClick={retry}>{t('retry')}</Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex min-h-[34rem] flex-col gap-[14px]" aria-busy="true" aria-label={t('loading')}>
      <Skeleton className="h-12 w-1/2" />
      <div className="grid gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4].map((card) => <Skeleton key={card} className="h-32" />)}
      </div>
      <div className="grid gap-[14px] lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
