'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMonth } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import type { MarketRowView } from './market-row-view';

/**
 * The two values the add form does not ask for, shown as they will be saved:
 * the studio unit, and the cost (the newest priced month the row shows; the
 * server takes the newest priced month of the item's whole history).
 */
export function MarketAddCost({ item, unitLabel }: { item: MarketRowView; unitLabel: string }) {
  const t = useTranslations('marketBook');
  const tp = useTranslations('priceBook');
  const locale = useLocale();
  const latestPriced = item.latestPriced;
  return (
    <dl className="grid grid-cols-1 gap-3 rounded-item border p-3 sm:grid-cols-2">
      <div className="space-y-0.5">
        <dt className="text-caption text-muted-foreground">{tp('form.unit')}</dt>
        <dd className="text-body">{unitLabel}</dd>
      </div>
      <div className="space-y-0.5">
        <dt className="text-caption text-muted-foreground">{tp('form.cost')}</dt>
        <dd className="font-mono tabular-nums">
          <span dir="ltr">{formatMoney(latestPriced?.price ?? '0', locale)}</span>
        </dd>
        <dd className="text-caption text-muted-foreground">
          {latestPriced ? t('addForm.costFrom', { month: formatMonth(latestPriced.month, locale) }) : t('addForm.noPrice')}
        </dd>
      </div>
    </dl>
  );
}
