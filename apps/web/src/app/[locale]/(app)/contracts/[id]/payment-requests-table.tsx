'use client';

import { useTranslations } from 'next-intl';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import type { PaymentsAct } from './payments-act-dialog';
import { RequestRow, type BillingMay } from './request-row';

/** The contract's payment requests, newest first (at most 100, then a notice); under an issued final account, why only it may be voided. */
export function PaymentRequestsTable({
  view,
  may,
  m,
  onOpen,
}: {
  view: ContractBillingView;
  may: BillingMay;
  m: (value: string) => string;
  onOpen: (act: PaymentsAct) => void;
}) {
  const t = useTranslations('contracts.execution.payments.requests');
  return (
    <section className="space-y-2">
      <h3 className="text-body font-semibold">{t('title')}</h3>
      {view.requests.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead className="text-caption text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pe-3 text-start font-medium">{t('request')}</th>
                <th className="py-2 pe-3 text-start font-medium">{t('dates')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('amount')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('paid')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('outstanding')}</th>
                <th className="py-2 pe-3 text-start font-medium">{t('state')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {view.requests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  may={may}
                  finalAccountIssued={view.finalAccountIssued}
                  m={m}
                  onRecord={() => onOpen({ kind: 'record', request })}
                  onVoid={() => onOpen({ kind: 'void', request })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.moreRequests && <p className="text-caption text-muted-foreground">{t('more')}</p>}
      {view.finalAccountIssued && may.issue && <p className="text-caption text-muted-foreground">{t('voidClosed')}</p>}
    </section>
  );
}
