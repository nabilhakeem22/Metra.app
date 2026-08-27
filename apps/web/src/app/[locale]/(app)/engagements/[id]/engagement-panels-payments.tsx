'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EngagementPayment } from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { Empty, HEAD_ROW, MONEY } from './engagement-panels-parts';

export function PaymentsPanel({ payments }: { payments: EngagementPayment[] }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  if (payments.length === 0) return <Empty text={t('payments.empty')} />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={HEAD_ROW}>
          <th className="py-2 text-start font-medium">{t('payments.kind')}</th>
          <th className="py-2 text-end font-medium">{t('payments.amount')}</th>
          <th className="py-2 text-start font-medium">{t('payments.reference')}</th>
          <th className="py-2 text-start font-medium">{t('payments.clearedAt')}</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id} className="border-b border-[color:var(--rule)] last:border-0">
            <td className="py-2">{t(`paymentKind.${p.kind}`)}</td>
            <td className={`py-2 ${MONEY}`} dir="ltr">
              {formatMoney(p.amount, locale)}
            </td>
            <td className="py-2 text-[color:var(--text-muted)]" dir="ltr">
              {p.reference || '—'}
            </td>
            <td className="py-2 text-[color:var(--text-muted)]" dir="ltr">
              {formatDate(p.clearedAt, locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
