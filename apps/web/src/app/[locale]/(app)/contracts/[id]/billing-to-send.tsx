'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { RequestTarget } from './send-request-dialog';

/**
 * What the studio can bill next: each row of the signed schedule (with "send
 * request" until a live request bills it) and each approved change order that
 * adds money and has no request yet. `canSend` is false for a role without
 * `invoices_issue` and for a contract that cannot be billed (not signed,
 * terminated, or under an issued final account): the rows are then listed with
 * no button. A button only asks the tab to open the send dialog, which lives on
 * the tab so a read of the tab never unmounts it.
 */
export function BillingToSend({
  view,
  canSend,
  m,
  onSend,
}: {
  view: ContractBillingView;
  canSend: boolean;
  m: (value: string) => string;
  onSend: (target: RequestTarget) => void;
}) {
  const t = useTranslations('contracts.execution.payments');
  const locale = useLocale();
  const sendButton = (target: RequestTarget) => (
    <Button variant="default" size="sm" onClick={() => onSend(target)}>
      {t('send.open')}
    </Button>
  );

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-body font-semibold">{t('schedule.title')}</h3>
        <ul className="divide-y">
          {view.schedule.map((row) => {
            const label = pickLocale({ labelAr: row.labelAr, labelEn: row.labelEn }, 'label', locale).value;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2 text-body" data-milestone-billed={row.billed}>
                <span className="flex-1">{label}</span>
                <span dir="ltr" className="font-mono tabular-nums">{row.amount ? m(row.amount) : null}</span>
                {row.billed ? (
                  <span className="text-caption text-muted-foreground">{t('schedule.requested')}</span>
                ) : (
                  canSend && row.amount && sendButton({ kind: 'milestone', id: row.id, label, amount: row.amount })
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {view.variations.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-body font-semibold">{t('variations.title')}</h3>
          <ul className="divide-y">
            {view.variations.map((order) => {
              const title = pickLocale({ titleAr: order.titleAr, titleEn: order.titleEn }, 'title', locale).value;
              return (
                <li key={order.id} className="flex flex-wrap items-center gap-3 py-2 text-body">
                  <span dir="ltr" className="font-mono tabular-nums">{order.documentNumber}</span>
                  <span className="flex-1">{title}</span>
                  <span dir="ltr" className="font-mono tabular-nums">{m(order.charge)}</span>
                  {canSend && sendButton({ kind: 'variation', id: order.id, label: order.documentNumber, amount: order.charge })}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
