'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatMoney, formatMoneyAmount, moneySymbol } from '@/lib/format/money';

const FIGURE_CLASS = 'text-2xl font-extrabold tracking-tight tabular-nums';
const LABEL_CLASS = 'text-sm font-semibold text-muted-foreground';

/**
 * The issued budget band, big. Both bounds: "EGP low to high" on one LEFT-TO-RIGHT
 * row in both languages (Latin digits, the currency label once), pinned to the
 * reading start. One bound only: a plain "From X" / "Up to X" sentence in the
 * locale's direction, the figure bidi-isolated. No bound (the band is not issued):
 * nothing.
 */
export function BudgetRange({ rom }: { rom: PublicDelivery['rom'] }) {
  const t = useTranslations('delivery.budget');
  const locale = useLocale();
  const low = formatMoneyAmount(rom?.low, locale);
  const high = formatMoneyAmount(rom?.high, locale);

  if (low && high) {
    return (
      <p dir="ltr" className="flex flex-wrap items-baseline gap-2 rtl:justify-end">
        <span className={LABEL_CLASS}>{moneySymbol(locale)}</span>
        <span className={FIGURE_CLASS}>{low}</span>
        <span className="text-sm text-muted-foreground">{t('to')}</span>
        <span className={FIGURE_CLASS}>{high}</span>
      </p>
    );
  }
  if (!low && !high) return null;

  const sentence = low
    ? t('atLeast', { amount: bidiIsolate(formatMoney(rom?.low, locale)) })
    : t('atMost', { amount: bidiIsolate(formatMoney(rom?.high, locale)) });
  return <p className={FIGURE_CLASS}>{sentence}</p>;
}
