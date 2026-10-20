'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { leftToBillShown } from './billing-balance';
import { BillingToSend } from './billing-to-send';
import { ClaimsPanel } from './claims-panel';
import { PaymentRequestsTable } from './payment-requests-table';
import { PaymentsActDialog, type PaymentsAct } from './payments-act-dialog';
import { PaymentsLedger } from './payments-ledger';
import type { BillingMay } from './request-row';
import { useContractBilling } from './use-contract-billing';

/** Why nothing new can be billed, or null when requests may be sent. */
function closedReason(view: ContractBillingView): 'notSigned' | 'terminated' | 'finalAccountIssued' | null {
  if (view.status === 'terminated') return 'terminated';
  if (view.status !== 'signed') return 'notSigned';
  return view.finalAccountIssued ? 'finalAccountIssued' : null;
}

/**
 * The execution contract's money (plan A4.3): what is left to bill, the
 * client's "I paid" claims to answer (B4.2), the schedule rows and approved
 * change orders to send requests for, the requests with what is paid and due
 * on each, and the ledger.
 *
 * READ EVERY TIME IT IS SHOWN (A4 F3): the tab mounts when it is shown, so it
 * holds no view from before (a payment, a termination, a void made since), and
 * nothing is offered until that read is back. Every write answers with the
 * fresh view, and a write that failed or got no answer is followed by a read.
 */
export function PaymentsTab({ contractId, may, m }: { contractId: string; may: BillingMay; m: (value: string) => string }) {
  const t = useTranslations('contracts.execution.payments');
  const billing = useContractBilling(contractId);
  const { view, reload } = billing;
  const [act, setAct] = useState<PaymentsAct | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void reload();
  }, [reload]);

  const open = (next: PaymentsAct) => {
    setNotice(null);
    setAct(next);
  };
  const closed = view && closedReason(view);

  return (
    <Card>
      <CardContent className="space-y-6 py-4">
        {billing.error && (
          <p className="text-body text-destructive" role="alert">
            {billing.error}
          </p>
        )}
        {notice && (
          <p className="text-body" role="status">
            {notice}
          </p>
        )}
        {view === null ? (
          billing.loading && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('loading')} />
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-body font-semibold">{t('title')}</h2>
                <span className="text-caption text-muted-foreground">{t('leftToBill')}</span>
                <span dir="ltr" className="font-mono tabular-nums">{m(leftToBillShown(view.billingBalance))}</span>
              </div>
              {/* F3: the final account's balance adds the measured differences; this one does not. */}
              <p className="text-caption text-muted-foreground">{t('leftToBillHint')}</p>
            </div>
            {closed && <p className="text-body text-muted-foreground">{t(`closed.${closed}`)}</p>}
            <ClaimsPanel
              claims={view.claims}
              canAnswer={may.record}
              m={m}
              onConfirm={(claim) => open({ kind: 'confirmClaim', claim })}
              onDismiss={(claim) => open({ kind: 'dismissClaim', claim })}
            />
            <BillingToSend view={view} canSend={may.issue && closed === null} m={m} onSend={(target) => open({ kind: 'send', target })} />
            <PaymentRequestsTable view={view} may={may} m={m} onOpen={open} />
            <PaymentsLedger payments={view.payments} loading={billing.loading} m={m} onShowMore={() => void billing.showMorePayments()} />
            {act && (
              <PaymentsActDialog
                act={act}
                view={view}
                billing={billing}
                m={m}
                onAlreadyRecorded={() => setNotice(t('record.already'))}
                onAlreadyConfirmed={() => setNotice(t('claims.confirm.already'))}
                onClose={() => setAct(null)}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
