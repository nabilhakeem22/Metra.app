'use client';

import { useLocale, useTranslations } from 'next-intl';
import { isRequestClaimable } from '@/lib/engagements/public/execution-requests';
import { EXECUTION_LIST_CAP, type PortalExecution } from '@/lib/engagements/public/execution-types';
import { bidiIsolate } from '@/lib/format/bidi';
import { ClientCodePanel } from './client-code-panel';
import { ConfirmActDialog } from './confirm-act-dialog';
import { ExecutionEarlierClaims } from './execution-earlier-claims';
import { ExecutionReceipts } from './execution-receipts';
import { ExecutionRequestRow, useRequestLabel } from './execution-request-row';
import { PaymentInstructions } from './payment-instructions';
import { portalListMoney } from './portal-money';
import type { KnownCodeChannel } from './use-client-code';
import { useExecutionClaim } from './use-execution-claim';
import { useStudioWhatsappHref, type StudioContactFacts } from './use-studio-whatsapp';

/** Every amount the section prints, so they all keep one decimals rule. */
function amountsOf(execution: PortalExecution): string[] {
  return [
    ...execution.requests.flatMap((request) => [request.amount, request.paid, request.outstanding]),
    ...execution.receipts.map((receipt) => receipt.amount),
    ...execution.earlierClaims.map((claim) => claim.amount),
  ];
}

/**
 * The Execution tab's PAYMENTS (Stage 2, D1a): every payment request the
 * studio sent on the execution contract (newest first, at most 60) with
 * "I've made this payment" on each one still due, the client's notices still
 * waiting on an earlier contract of the delivery, how to pay while something
 * is due, and the payments received. Every amount in it keeps ONE decimals
 * rule (./portal-money.ts). Figures are what the client is asked to pay or has
 * paid, never the studio's own price basis. "I've made this payment" needs a
 * one-time code emailed to the client (the panel in its dialog; `channel` is
 * where it goes, or null with no address on file; `openOn` a request whose
 * dialog opens on the code box). A claim that landed, or a
 * request that moved on, tells the page (`onChanged`), whose hero then follows.
 * فصحى copy, Latin digits, money left to right.
 */
export function ExecutionPayments({
  token,
  initial,
  onChanged,
  channel,
  studio,
  openOn,
}: {
  token: string;
  initial: PortalExecution;
  onChanged: () => void;
  channel: KnownCodeChannel;
  studio: StudioContactFacts;
  /** The request whose claim opens on its code box (a code email's link), or null. */
  openOn: string | null;
}) {
  const t = useTranslations('delivery.execution');
  const tActions = useTranslations('delivery.actions');
  const locale = useLocale();
  const claim = useExecutionClaim(token, initial, onChanged, channel, openOn);
  const whatsappHref = useStudioWhatsappHref(studio.whatsappDigits, studio.deliveryRef, 'execution');
  const requestLabel = useRequestLabel();
  const { requests } = claim.execution;
  const money = portalListMoney(amountsOf(claim.execution), locale);
  const asking = requests.find((request) => request.id === claim.askingId && isRequestClaimable(request)) ?? null;

  return (
    <section id="payments" aria-labelledby="execution-payments-title" className="space-y-3 rounded-panel border bg-background p-4 shadow-sm">
      <h2 id="execution-payments-title" className="text-body font-semibold">
        {t('paymentsTitle')}
      </h2>
      <section aria-labelledby="execution-requests-title" className="space-y-1">
        <h3 id="execution-requests-title" className="text-caption font-semibold text-muted-foreground">
          {t('requests.title')}
        </h3>
        {requests.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t('requests.empty')}</p>
        ) : (
          <ul>
            {requests.map((request) => (
              <ExecutionRequestRow key={request.id} request={request} claim={claim} money={money} />
            ))}
          </ul>
        )}
        {claim.execution.requestsTruncated && (
          <p className="text-caption text-muted-foreground">{t('requests.truncated', { count: String(EXECUTION_LIST_CAP) })}</p>
        )}
      </section>
      <ExecutionEarlierClaims claims={claim.execution.earlierClaims} money={money} />
      {claim.execution.paymentDetails && <PaymentInstructions details={claim.execution.paymentDetails} phase="execution" />}
      <ExecutionReceipts receipts={claim.execution.receipts} truncated={claim.execution.receiptsTruncated} money={money} />
      <ConfirmActDialog
        open={asking !== null}
        title={t('confirmTitle')}
        body={
          <>
            <p>
              {asking &&
                t('confirmBody', {
                  request: `${requestLabel(asking)} ${bidiIsolate(asking.documentNumber)}`,
                  amount: bidiIsolate(money(asking.outstanding)),
                })}
            </p>
            <ClientCodePanel code={claim.code} studioName={studio.name} whatsappHref={whatsappHref} />
          </>
        }
        confirmLabel={tActions('confirm')}
        cancelLabel={tActions('cancel')}
        pending={claim.pending}
        confirmDisabled={!claim.code.ready}
        confirmShown={!claim.code.noChannel}
        onConfirm={claim.confirm}
        onOpenChange={(open) => !open && claim.dismiss()}
      />
    </section>
  );
}
