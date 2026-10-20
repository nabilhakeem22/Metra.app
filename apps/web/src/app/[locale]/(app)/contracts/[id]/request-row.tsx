'use client';

import { useLocale, useTranslations } from 'next-intl';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { PaymentRequestRow } from '@/lib/execution/requests/queries';
import { formatDate } from '@/lib/format/date';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { RecordPaymentDialog } from './record-payment-dialog';
import { VoidRequestDialog } from './void-request-dialog';

export interface BillingMay {
  /** `invoices_issue`: send and void requests. */
  issue: boolean;
  /** `payments` create: record money received. */
  record: boolean;
}

/** What the request bills, in the studio's language. */
function useTargetLabel() {
  const t = useTranslations('contracts.execution.payments.requests');
  const locale = useLocale();
  return (target: PaymentRequestRow['target']) => {
    if (target === null) return t('finalAccount');
    if ('variation' in target) return t('variationTarget', { number: target.variation });
    return pickLocale(target, 'label', locale).value;
  };
}

/**
 * One payment request on the Payments tab: what it bills, when, how much, what
 * is paid and still due, and the two things the studio may do with it. A
 * payment is offered while something is due and no client claim waits (the
 * claim is answered first, B4); a void only while nothing is paid or claimed.
 */
export function RequestRow({
  request,
  may,
  m,
  onChanged,
}: {
  request: PaymentRequestRow;
  may: BillingMay;
  m: (value: string) => string;
  onChanged: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.requests');
  const locale = useLocale();
  const targetLabel = useTargetLabel();
  const live = request.status === 'issued';
  const due = parseMoney4(request.outstanding) > 0n;
  const status = !live ? 'void' : due ? 'issued' : 'paid';
  const settled = request.hasPendingClaim || parseMoney4(request.paid) > 0n;

  return (
    <tr className="border-b align-top last:border-0" data-request-status={status}>
      <td className="py-2 pe-3">
        <div dir="ltr" className="text-start font-mono tabular-nums">{request.documentNumber}</div>
        <div className="text-caption text-muted-foreground">{targetLabel(request.target)}</div>
      </td>
      <td className="py-2 pe-3 text-caption text-muted-foreground">
        <div>{t('issuedOn', { date: formatDate(request.issuedOn, locale) })}</div>
        {request.dueOn && <div>{t('dueOn', { date: formatDate(request.dueOn, locale) })}</div>}
      </td>
      <td className="py-2 pe-3 text-end font-mono tabular-nums" dir="ltr">{m(request.amount)}</td>
      <td className="py-2 pe-3 text-end font-mono tabular-nums" dir="ltr">{m(request.paid)}</td>
      <td className="py-2 pe-3 text-end font-mono tabular-nums" dir="ltr">{m(request.outstanding)}</td>
      <td className="py-2 pe-3">
        <div>{t(`status.${status}`)}</div>
        {request.hasPendingClaim && <div className="text-caption text-[color:var(--warn)]">{t('claimPending')}</div>}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap justify-end gap-1">
          {live && due && may.record && !request.hasPendingClaim && (
            <RecordPaymentDialog request={request} m={m} onRecorded={onChanged} />
          )}
          {live && may.issue && !settled && <VoidRequestDialog request={request} onVoided={onChanged} />}
        </div>
      </td>
    </tr>
  );
}
