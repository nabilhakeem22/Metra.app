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
  | { status: 'rateLimited' }
  | { status: 'workspaceChanged' }
  | { status: 'withheld' }
  | { status: 'ready'; ledger: RescueLedger };

/** What each refusal status means here; any other answer that is not the ledger is a failure. */
const REFUSALS: Record<number, LedgerState> = {
  403: { status: 'withheld' },
  409: { status: 'workspaceChanged' },
  429: { status: 'rateLimited' },
};

/** One GET for the workspace this page was rendered for, never cached. */
async function fetchLedger(range: RangeMonths, orgId: string, signal: AbortSignal): Promise<LedgerState> {
  const query = new URLSearchParams({ range: String(range), org: orgId });
  const response = await fetch(`${RESCUE_LEDGER_PATH}?${query}`, { credentials: 'same-origin', cache: 'no-store', signal });
  const refusal = REFUSALS[response.status];
  if (refusal) return refusal;
  const body = (await response.json()) as RescueLedgerResponse;
  return body.ok ? { status: 'ready', ledger: body.ledger } : { status: 'failed' };
}

/** A one line notice with its one action, for the states that are not the ledger. */
function Notice({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <Card role="alert">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p className="text-body text-muted-foreground">{text}</p>
        <Button variant="secondary" onClick={onAction}>{action}</Button>
      </CardContent>
    </Card>
  );
}

/**
 * The rescue ledger island: fetches on mount (and on a retry), shows a skeleton
 * of the block's own height meanwhile, and on a failure says so with a retry
 * while the rest of the dashboard stays as it is. Past the read budget it says
 * to wait a minute; when the session moved to another workspace (another tab)
 * it offers a reload rather than draw that workspace's figures here. A refusal
 * (the studio limited firm figures after the page rendered) renders nothing,
 * like the firm block.
 */
export function RescueLedgerSection({ range, orgId }: { range: RangeMonths; orgId: string }) {
  const t = useTranslations('dashboard.rescue');
  const locale = useLocale();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LedgerState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchLedger(range, orgId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'failed' });
      });
    return () => controller.abort();
  }, [range, orgId, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  switch (state.status) {
    case 'withheld':
      return null;
    case 'ready':
      return <RescueLedgerView ledger={state.ledger} locale={locale} />;
    case 'failed':
      return <Notice text={t('loadFailed')} action={t('retry')} onAction={retry} />;
    case 'rateLimited':
      return <Notice text={t('rateLimited')} action={t('retry')} onAction={retry} />;
    case 'workspaceChanged':
      return <Notice text={t('workspaceChanged')} action={t('reload')} onAction={() => window.location.reload()} />;
    case 'loading':
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
}
