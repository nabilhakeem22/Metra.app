'use client';

import { atPriceBookScale, withFivePercentMargin } from '@metra/db/market-seed';
import { useLocale, useTranslations } from 'next-intl';
import { formatMonth } from '@/lib/format/date';
import { formatMoneyExact } from '@/lib/format/money';
import type { MarketPricedMonth } from '@/lib/market-book/types';

/**
 * The values the add form does not ask for, shown as they will be saved: the
 * studio unit, the cost (the newest priced month of the item's whole history,
 * with its month, and a warning when it is older than the row's window), and
 * the selling price an empty price box takes (the seed's cost x 1.05).
 */
export function MarketAddCost({ priced, isOld, unitLabel }: { priced: MarketPricedMonth; isOld: boolean; unitLabel: string }) {
  const t = useTranslations('marketBook');
  const tp = useTranslations('priceBook');
  const locale = useLocale();
  return (
    <dl className="grid grid-cols-1 gap-3 rounded-item border p-3 sm:grid-cols-3">
      <div className="space-y-0.5">
        <dt className="text-caption text-muted-foreground">{tp('form.unit')}</dt>
        <dd className="text-body">{unitLabel}</dd>
      </div>
      <div className="space-y-0.5">
        <dt className="text-caption text-muted-foreground">{tp('form.cost')}</dt>
        <dd className="font-mono tabular-nums">
          <span dir="ltr">{formatMoneyExact(atPriceBookScale(priced.price), locale)}</span>
        </dd>
        <dd className="text-caption text-muted-foreground">{t('addForm.costFrom', { month: formatMonth(priced.month, locale) })}</dd>
        {isOld && <dd className="text-caption text-[color:var(--warn)]">{t('addForm.oldPrice')}</dd>}
      </div>
      <div className="space-y-0.5">
        <dt className="text-caption text-muted-foreground">{t('addForm.defaultPrice')}</dt>
        <dd className="font-mono tabular-nums">
          <span dir="ltr">{formatMoneyExact(withFivePercentMargin(priced.price), locale)}</span>
        </dd>
        <dd className="text-caption text-muted-foreground">{t('addForm.defaultPriceRule')}</dd>
      </div>
    </dl>
  );
}
