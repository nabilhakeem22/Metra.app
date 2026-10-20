'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { PaymentRequestRow } from '@/lib/execution/requests/queries';
import { formatDate } from '@/lib/format/date';
import { pickLocale } from '@/lib/i18n/pick-locale';

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
 * One payment request on the Payments tab: what it bills and the note sent
 * with it, when, how much, what is paid and still due, and the two things the
 * studio may do with it. A payment is offered while something is due and no
 * client claim waits (the claim is answered first, B4); a void only while
 * nothing is paid or claimed. The buttons only ask the tab to open the act: its
 * dialog lives on the tab, so a read of the tab never unmounts it.
 */
export function RequestRow({
  request,
  may,
  m,
  onRecord,
  onVoid,
}: {
  request: PaymentRequestRow;
  may: BillingMay;
  m: (value: string) => string;
  onRecord: () => void;
  onVoid: () => void;
}) {
  const t = useTranslations('contracts.execution.payments');
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
        {request.note && <div className="whitespace-pre-line break-words text-caption text-muted-foreground" data-request-note>{request.note}</div>}
      </td>
      <td className="py-2 pe-3 text-caption text-muted-foreground">
        <div>{t('requests.issuedOn', { date: formatDate(request.issuedOn, locale) })}</div>
        {request.dueOn && <div>{t('requests.dueOn', { date: formatDate(request.dueOn, locale) })}</div>}
      </td>
      <td className="py-2 pe-3 text-end font-mono tabular-nums" dir="ltr">{m(request.amount)}</td>
      <td className="py-2 pe-3 text-end font-mono tabular-nums" dir="ltr">{m(request.paid)}</td>
      <td className="py-2 pe-3 text-end font-mono tabular-nums" dir="ltr">{m(request.outstanding)}</td>
      <td className="py-2 pe-3">
        <div>{t(`requests.status.${status}`)}</div>
        {request.hasPendingClaim && <div className="text-caption text-[color:var(--warn)]">{t('requests.claimPending')}</div>}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap justify-end gap-1">
          {live && due && may.record && !request.hasPendingClaim && (
            <Button variant="secondary" size="sm" onClick={onRecord}>
              {t('record.open')}
            </Button>
          )}
          {live && may.issue && !settled && (
            <Button variant="ghost" size="sm" onClick={onVoid}>
              {t('void.open')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
