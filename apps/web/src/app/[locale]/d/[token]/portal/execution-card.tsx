'use client';

import { useLocale, useTranslations } from 'next-intl';
import { EXECUTION_LIST_CAP, type PortalExecution } from '@/lib/engagements/public/execution-types';
import { bidiIsolate } from '@/lib/format/bidi';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { ConfirmActDialog } from './confirm-act-dialog';
import { ExecutionEarlierClaims } from './execution-earlier-claims';
import { ExecutionReceipts } from './execution-receipts';
import { ExecutionRequestRow, isClaimable, useRequestLabel } from './execution-request-row';
import { PaymentInstructions } from './payment-instructions';
import { formatPortalMoney } from './portal-money';
import { useExecutionClaim } from './use-execution-claim';

/**
 * The client's execution contract on the delivery page (Stage 2, D1a): the
 * contract's number, status and value, every payment request the studio sent
 * (newest first, at most 60) with "I've made this payment" on each one still
 * due, the client's notices still waiting on an earlier contract of the
 * delivery, how to pay while something is due, and the payments received. Shown only for
 * a delivery at `execution` with a contract the client can see. Figures are
 * what the client is asked to pay or has paid, never the studio's own price
 * basis. فصحى copy, Latin digits, money left to right.
 */
export function ExecutionCard({ token, initial }: { token: string; initial: PortalExecution }) {
  const t = useTranslations('delivery.execution');
  const tActions = useTranslations('delivery.actions');
  const locale = useLocale();
  const claim = useExecutionClaim(token, initial);
  const requestLabel = useRequestLabel();
  const { contract, requests } = claim.execution;
  const money = (amount: string) => bidiIsolate(formatPortalMoney(amount, locale));
  const title = pickLocale(contract, 'title', locale).value;
  const asking = requests.find((request) => request.id === claim.askingId && isClaimable(request)) ?? null;

  return (
    <section aria-labelledby="execution-card-title" className="space-y-3 rounded-panel border bg-background p-4 shadow-sm">
      <div className="space-y-0.5">
        <h2 id="execution-card-title" className="text-body font-semibold">
          {t('title')}
        </h2>
        {title && <p className="text-caption text-muted-foreground">{title}</p>}
        <p className="text-caption text-muted-foreground">
          {t('contract', { number: bidiIsolate(contract.documentNumber) })}
          {' · '}
          {t(`status.${contract.status}`)}
          {' · '}
          {t('contractValue', { amount: money(contract.originalValue) })}
        </p>
      </div>
      <section aria-labelledby="execution-requests-title" className="space-y-1">
        <h3 id="execution-requests-title" className="text-caption font-semibold text-muted-foreground">
          {t('requests.title')}
        </h3>
        {requests.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t('requests.empty')}</p>
        ) : (
          <ul>
            {requests.map((request) => (
              <ExecutionRequestRow key={request.id} request={request} claim={claim} />
            ))}
          </ul>
        )}
        {claim.execution.requestsTruncated && (
          <p className="text-caption text-muted-foreground">{t('requests.truncated', { count: String(EXECUTION_LIST_CAP) })}</p>
        )}
      </section>
      <ExecutionEarlierClaims claims={claim.execution.earlierClaims} />
      {claim.execution.paymentDetails && <PaymentInstructions details={claim.execution.paymentDetails} />}
      <ExecutionReceipts receipts={claim.execution.receipts} truncated={claim.execution.receiptsTruncated} />
      <ConfirmActDialog
        open={asking !== null}
        title={t('confirmTitle')}
        body={
          <p>
            {asking &&
              t('confirmBody', {
                request: `${requestLabel(asking)} ${bidiIsolate(asking.documentNumber)}`,
                amount: money(asking.outstanding),
              })}
          </p>
        }
        confirmLabel={tActions('confirm')}
        cancelLabel={tActions('cancel')}
        pending={claim.pending}
        onConfirm={claim.confirm}
        onOpenChange={(open) => !open && claim.dismiss()}
      />
    </section>
  );
}
