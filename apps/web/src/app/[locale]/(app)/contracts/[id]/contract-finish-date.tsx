'use client';

import { useLocale, useTranslations } from 'next-intl';
import { revisedFinishDate } from '@/lib/execution/finish-date';
import { formatDate } from '@/lib/format/date';
import { formatNumber } from '@/lib/format/number';

/**
 * The days the contract's APPROVED change orders add to its finish date (A24),
 * and the revised finish day when the contract has an end date. Says nothing
 * while no approved order adds a day.
 */
export function ContractFinishDate({
  endDate,
  approvedExtensionDays,
}: {
  endDate: string | null;
  approvedExtensionDays: number;
}) {
  const t = useTranslations('contracts.execution.finish');
  const locale = useLocale();
  if (approvedExtensionDays <= 0) return null;
  const revised = revisedFinishDate(endDate, approvedExtensionDays);
  const days = { count: approvedExtensionDays, n: formatNumber(approvedExtensionDays, locale) };

  return (
    <span className="text-muted-foreground">
      {revised ? t('revised', { ...days, date: formatDate(revised, locale) }) : t('added', days)}
    </span>
  );
}
