'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EngagementChangeOrderRecord } from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { Empty, HEAD_ROW, MONEY } from './engagement-panels-parts';

export function ChangeOrdersPanel({
  changeOrders,
}: {
  changeOrders: EngagementChangeOrderRecord[];
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  if (changeOrders.length === 0) return <Empty text={t('changeOrders.empty')} />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={HEAD_ROW}>
          <th className="py-2 text-end font-medium">{t('changeOrders.amount')}</th>
          <th className="py-2 text-start font-medium">{t('changeOrders.status')}</th>
          <th className="py-2 text-start font-medium">{t('changeOrders.raisedAt')}</th>
        </tr>
      </thead>
      <tbody>
        {changeOrders.map((c) => (
          <tr key={c.id} className="border-b border-[color:var(--rule)] last:border-0">
            <td className={`py-2 ${MONEY}`} dir="ltr">
              {formatMoney(c.amount, locale)}
            </td>
            <td className="py-2">{t(`changeOrderStatus.${c.status}`)}</td>
            <td className="py-2 text-[color:var(--text-muted)]" dir="ltr">
              {formatDate(c.raisedAt, locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
