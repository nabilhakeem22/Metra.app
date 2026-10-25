'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMonth } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import type { MarketPriceRef } from '@/lib/market-book/types';

const ONE_DECIMAL: Intl.NumberFormatOptions = Object.freeze({ minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });

/**
 * The price book's Market cell (market plan C7): the linked market item's
 * price, its month and how far the item's cost is from it ("+5.0%" = the cost
 * is 5% above the official price). A dash, with the reason as its tooltip,
 * when the item is not linked, the units do not compare, or there is no price.
 * Reference only: no colour says good or bad.
 */
export function MarketPriceCell({ linked, reference }: { linked: boolean; reference: MarketPriceRef | undefined }) {
  const t = useTranslations('priceBook.market');
  const locale = useLocale();
  if (!reference || reference.reason !== 'ok' || reference.price === null || reference.month === null || reference.variancePct === null) {
    const why = !linked ? t('unlinked') : reference?.reason === 'unit_mismatch' ? t('unitMismatch') : t('noPrice');
    return (
      <span className="text-muted-foreground" title={why}>
        <span aria-hidden>-</span>
        <span className="sr-only">{why}</span>
      </span>
    );
  }
  const variance = `${formatNumber(reference.variancePct, locale, ONE_DECIMAL)}%`;
  return (
    <div className="space-y-0.5">
      <div className="font-mono tabular-nums" dir="ltr">
        {formatMoney(reference.price, locale)}
      </div>
      <div className="flex items-center justify-end gap-1 text-caption text-muted-foreground">
        <span>{formatMonth(reference.month, locale)}</span>
        <span aria-hidden className="rounded-pill bg-[color:var(--track)] px-2 py-0.5 font-mono tabular-nums text-[color:var(--text)]" dir="ltr">
          {variance}
        </span>
        <span className="sr-only">{t('variance', { value: variance })}</span>
      </div>
    </div>
  );
}
