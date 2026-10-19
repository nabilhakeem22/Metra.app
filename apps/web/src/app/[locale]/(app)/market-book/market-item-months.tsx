'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMonth } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import type { MarketPoint } from '@/lib/market-book/types';

/** Every effective month, newest first, each with the bulletin and page it comes from. */
export function MarketItemMonths({ points }: { points: readonly MarketPoint[] }) {
  const t = useTranslations('marketBook');
  const locale = useLocale();
  return (
    <ol className="divide-y rounded-item border">
      {[...points].reverse().map((point) => (
        <li key={point.month} className="flex items-start justify-between gap-3 px-3 py-2">
          <div className="space-y-0.5">
            <div className="text-body font-medium">{formatMonth(point.month, locale)}</div>
            <div className="text-caption text-muted-foreground">
              {t('drawer.source', { month: formatMonth(point.bulletinMonth, locale), page: formatNumber(point.sourcePage, locale) })}
            </div>
          </div>
          {point.status === 'priced' ? (
            <div dir="ltr" className="whitespace-nowrap text-end font-mono tabular-nums">
              {formatMoney(point.price, locale)}
            </div>
          ) : (
            <span className="rounded-pill bg-[color:var(--warn-tint)] px-2 py-0.5 text-caption text-[color:var(--warn)]">{t('suspended')}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
