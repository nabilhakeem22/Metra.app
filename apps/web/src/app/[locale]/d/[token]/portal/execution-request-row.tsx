'use client';

import { Clock, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { PortalExecutionRequest } from '@/lib/engagements/public/execution-types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { describeExecutionFailure } from './execution-failure';
import { formatPortalMoney } from './portal-money';
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

/** Something is still due on it (a void request is due nothing). */
const isDue = (request: PortalExecutionRequest): boolean => /[1-9]/.test(request.outstanding);

/** True when the client may say they paid it: live, something due, no claim waiting. */
export function isClaimable(request: PortalExecutionRequest): boolean {
  return !request.void && request.claimedAt === null && isDue(request);
}

/**
 * One payment request on the client's execution card: its number and what it
 * bills, when it was issued and is due, what is paid and still due, and either
 * "I made this payment", the note that the client's claim is being checked, or
 * that it is paid or withdrawn. Money per the Money law: Latin digits, left to
 * right, at the row's end.
 */
export function ExecutionRequestRow({ request, claim }: { request: PortalExecutionRequest; claim: ExecutionClaim }) {
  const t = useTranslations('delivery.execution');
  const tErrors = useTranslations('portal.errors');
  const locale = useLocale();
  const label = useRequestLabel();
  const money = (amount: string) => bidiIsolate(formatPortalMoney(amount, locale));
  const day = (date: string) => bidiIsolate(formatDate(date, locale));
  const due = isDue(request);
  const failure = claim.failure?.requestId === request.id ? claim.failure.shown : null;

  return (
    <li className="space-y-1.5 border-t py-3 first:border-t-0" data-request-id={request.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body font-medium">{label(request)}</p>
          <p className="text-caption text-muted-foreground">
            <span dir="ltr">{request.documentNumber}</span>
            {' · '}
            {t('requests.issuedOn', { date: day(request.issuedOn) })}
            {request.dueOn && !request.void && due ? ` · ${t('requests.dueOn', { date: day(request.dueOn) })}` : null}
          </p>
        </div>
        <span dir="ltr" className="shrink-0 text-end font-mono text-body font-semibold tabular-nums">
          {formatPortalMoney(request.amount, locale)}
        </span>
      </div>
      {request.void ? (
        <p className="text-caption text-muted-foreground">{t('requests.void')}</p>
      ) : due ? (
        <p className="text-caption text-muted-foreground">
          {t('requests.paidOf', { paid: money(request.paid), amount: money(request.amount) })}
          {' · '}
          <span className="font-medium text-foreground">{t('requests.outstanding', { amount: money(request.outstanding) })}</span>
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
      {isClaimable(request) && (
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
