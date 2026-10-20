'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { BillingToSend } from './billing-to-send';
import { PaymentsLedger } from './payments-ledger';
import { RequestRow, type BillingMay } from './request-row';
import type { ContractBilling } from './use-contract-billing';

/** Why nothing new can be billed, or null when requests may be sent. */
function closedReason(view: ContractBillingView): 'notSigned' | 'terminated' | 'finalAccountIssued' | null {
  if (view.status === 'terminated') return 'terminated';
  if (view.status !== 'signed') return 'notSigned';
  return view.finalAccountIssued ? 'finalAccountIssued' : null;
}

/**
 * The execution contract's money (plan A4.3): what is left to bill, the
 * schedule rows and approved change orders to send requests for, the requests
 * with what is paid and due on each, and the ledger. Read on demand when the
 * tab is first shown, and again after every change it makes.
 */
export function PaymentsTab({
  billing,
  may,
  m,
}: {
  billing: ContractBilling;
  may: BillingMay;
  m: (value: string) => string;
}) {
  const t = useTranslations('contracts.execution.payments');
  const { view, reload } = billing;
  const unread = view === null;

  useEffect(() => {
    if (unread) void reload();
  }, [unread, reload]);

  const refresh = () => void reload();
  const closed = view && closedReason(view);

  return (
    <Card>
      <CardContent className="space-y-6 py-4">
        {billing.error && (
          <p className="text-body text-destructive" role="alert">
            {billing.error}
          </p>
        )}
        {view === null ? (
          billing.loading && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('loading')} />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-body font-semibold">{t('title')}</h2>
              <span className="text-caption text-muted-foreground">{t('leftToBill')}</span>
              <span dir="ltr" className="font-mono tabular-nums">{m(view.billingBalance)}</span>
            </div>
            {closed && <p className="text-body text-muted-foreground">{t(`closed.${closed}`)}</p>}
            <BillingToSend view={view} canSend={may.issue && closed === null} m={m} onSent={refresh} />
            <section className="space-y-2">
              <h3 className="text-body font-semibold">{t('requests.title')}</h3>
              {view.requests.length === 0 ? (
                <p className="text-body text-muted-foreground">{t('requests.empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-body">
                    <thead className="text-caption text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pe-3 text-start font-medium">{t('requests.request')}</th>
                        <th className="py-2 pe-3 text-start font-medium">{t('requests.dates')}</th>
                        <th className="py-2 pe-3 text-end font-medium">{t('requests.amount')}</th>
                        <th className="py-2 pe-3 text-end font-medium">{t('requests.paid')}</th>
                        <th className="py-2 pe-3 text-end font-medium">{t('requests.outstanding')}</th>
                        <th className="py-2 pe-3 text-start font-medium">{t('requests.state')}</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {view.requests.map((request) => (
                        <RequestRow key={request.id} request={request} may={may} m={m} onChanged={refresh} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {view.moreRequests && <p className="text-caption text-muted-foreground">{t('requests.more')}</p>}
            </section>
            <PaymentsLedger payments={view.payments} loading={billing.loading} m={m} onShowMore={() => void billing.showMorePayments()} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
