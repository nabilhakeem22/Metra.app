'use client';

import { Clock, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { isRequestClaimable, isRequestDue } from '@/lib/engagements/public/execution-requests';
import type { PortalExecutionRequest } from '@/lib/engagements/public/execution-types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { DocumentNumber } from './document-number';
import { describeExecutionFailure } from './execution-failure';
import type { PortalListMoney } from './portal-money';
import type { ExecutionClaim } from './use-execution-claim';

/** What a request bills, in the client's words. */
export function useRequestLabel() {
  const t = useTranslations('delivery.execution.requests');
  const locale = useLocale();
  return (request: PortalExecutionRequest) => {
    const { target } = request;
    if (target.kind === 'final_account') return t('finalAccount');
    if (target.kind === 'variation') {
      return target.documentNumber ? t('variation', { number: bidiIsolate(target.documentNumber) }) : t('variationUnnumbered');
    }
    return pickLocale(target, 'label', locale).value || t('instalment');
  };
}

/**
 * One payment request in the Execution tab's payments: its number and what it
 * bills, when it was issued and is due, what is paid and still due, and either
 * "I've made this payment", the note that the client's claim is being checked, or
 * that it is paid or withdrawn. Money per the Money law: Latin digits, left to
 * right, at the row's end, under the decimals rule of the whole list (`money`).
 */
export function ExecutionRequestRow({
  request,
  claim,
  money,
}: {
  request: PortalExecutionRequest;
  claim: ExecutionClaim;
  money: PortalListMoney;
}) {
  const t = useTranslations('delivery.execution');
  const tErrors = useTranslations('portal.errors');
  const locale = useLocale();
  const label = useRequestLabel();
  const isolated = (amount: string) => bidiIsolate(money(amount));
  const day = (date: string) => bidiIsolate(formatDate(date, locale));
  const due = isRequestDue(request);
  const failure = claim.failure?.requestId === request.id ? claim.failure.shown : null;

  return (
    <li id={`request-${request.id}`} className="space-y-1.5 border-t py-3 first:border-t-0" data-request-id={request.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body font-medium">{label(request)}</p>
          <p className="text-caption text-muted-foreground">
            <DocumentNumber>{request.documentNumber}</DocumentNumber>
            {' · '}
            {t('requests.issuedOn', { date: day(request.issuedOn) })}
            {request.dueOn && !request.void && due ? ` · ${t('requests.dueOn', { date: day(request.dueOn) })}` : null}
          </p>
        </div>
        <span dir="ltr" className="shrink-0 text-end font-mono text-body font-semibold tabular-nums">
          {money(request.amount)}
        </span>
      </div>
      {request.void ? (
        <p className="text-caption text-muted-foreground">{t('requests.void')}</p>
      ) : due ? (
        <p className="text-caption text-muted-foreground">
          {t('requests.paidOf', { paid: isolated(request.paid), amount: isolated(request.amount) })}
          {' · '}
          <span className="font-medium text-foreground">{t('requests.outstanding', { amount: isolated(request.outstanding) })}</span>
        </p>
      ) : (
        <p className="text-caption font-medium text-[color:var(--success)]">{t('requests.paid')}</p>
      )}
      {request.claimedAt && (
        <div role="status" className="space-y-0.5 text-caption font-medium text-muted-foreground">
          <p className="flex items-start gap-1.5">
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('claimedOn', { date: day(request.claimedAt) })}
          </p>
          {claim.notifiedIds.has(request.id) && <p>{t('claimNotified')}</p>}
        </div>
      )}
      {isRequestClaimable(request) && (
        <Button variant="secondary" className="w-full" disabled={claim.pending} onClick={() => claim.ask(request.id)}>
          {claim.submittingId === request.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('claim')}
        </Button>
      )}
      {failure && (
        <p className="text-caption text-destructive" role="alert">
          {describeExecutionFailure(failure, tErrors, (key) => t(`error.${key}`))}
        </p>
      )}
    </li>
  );
}
