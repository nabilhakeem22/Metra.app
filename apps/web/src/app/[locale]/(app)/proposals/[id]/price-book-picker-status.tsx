'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/format/number';
import type { PriceBookSearchState } from './use-price-book-search';

/**
 * The line under the picker's list: why the ask failed, that the first answer
 * is loading, that nothing matched, or how many matches the list leaves out
 * (in Latin digits, both languages).
 */
export function PriceBookPickerStatus({
  answer,
  matched,
  hidden,
}: {
  answer: PriceBookSearchState;
  matched: number;
  hidden: number;
}) {
  const t = useTranslations('proposals.builder');
  const locale = useLocale();
  if (answer.failure) {
    return (
      <p role="alert" className="px-2 py-2 text-caption text-destructive">
        {answer.failure}
      </p>
    );
  }
  if (answer.search === null) {
    return (
      <p role="status" className="px-2 py-2 text-caption text-muted-foreground">
        {t('priceBookLoading')}
      </p>
    );
  }
  if (matched === 0) {
    return answer.stale ? null : <p className="px-2 py-2 text-caption text-muted-foreground">{t('priceBookNothing')}</p>;
  }
  if (hidden === 0) return null;
  return (
    <p className="px-2 pt-2 text-caption text-muted-foreground">
      {t('priceBookMore', { count: hidden, shown: formatNumber(hidden, locale) })}
    </p>
  );
}
