'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  STACKED_BODY,
  STACKED_CELL,
  STACKED_HEAD,
  STACKED_LEAD_CELL,
  STACKED_ROW,
  STACKED_TABLE,
  StackedLabel,
} from '@/components/ui/stacked-table';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { FinalAccountView } from '@/lib/execution/final-account/load';
import { formatNumber, formatPercent } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { formatMeasuredQty, measurableLineLabel } from './measurement-row';

const FIGURE_CELL = `${STACKED_CELL} sm:text-end`;

/**
 * The lines whose final measured quantity differs from the contract quantity
 * plus what change orders ordered (50 at a time, document order): a
 * provisional one with the works its difference bills (D2a), a firm one
 * flagged as needing a change order. Counts of each kind head the list, and
 * under a document discount a note says the lines are before it (F8). Each
 * row is a card on a phone, its works or its flag in view (F1).
 */
export function FinalAccountDifferences({
  view,
  loading,
  m,
  onShowMore,
}: {
  view: FinalAccountView;
  loading: boolean;
  m: (value: string) => string;
  onShowMore: () => void;
}) {
  const t = useTranslations('contracts.execution.finalAccount.differences');
  const locale = useLocale();
  const qty = (value: string, unit: string) => (
    <span dir="ltr" className="font-mono tabular-nums">
      {formatMeasuredQty(value, locale)} {unit}
    </span>
  );
  const count = (value: number) => formatNumber(value, locale);
  const discounted = parseMoney4(view.documentDiscountPct) !== 0n;

  return (
    <section className="space-y-2">
      <h3 className="text-body font-semibold">{t('title')}</h3>
      {view.differences.rows.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <p className="text-caption text-muted-foreground">{t('counts', { billed: count(view.counts.billed), flagged: count(view.counts.flagged) })}</p>
          {discounted && view.counts.billed > 0 && (
            <p className="text-caption text-muted-foreground">{t('discountNote', { pct: formatPercent(view.documentDiscountPct, locale) })}</p>
          )}
          <table className={STACKED_TABLE}>
            <thead className={STACKED_HEAD}>
              <tr className="border-b">
                <th className="py-2 pe-3 text-start font-medium">{t('line')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('qty')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('ordered')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('measured')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('residual')}</th>
                <th className="py-2 text-end font-medium">{t('works')}</th>
              </tr>
            </thead>
            <tbody className={STACKED_BODY}>
              {view.differences.rows.map((row) => (
                <tr key={row.lineId} className={STACKED_ROW}>
                  <td className={STACKED_LEAD_CELL}>
                    <p>{measurableLineLabel(row, locale)}</p>
                    <p className="text-caption text-muted-foreground">
                      {pickLocale({ titleAr: row.sectionTitleAr, titleEn: row.sectionTitleEn }, 'title', locale).value}
                    </p>
                  </td>
                  <td className={FIGURE_CELL}>
                    <StackedLabel>{t('qty')}</StackedLabel>
                    {qty(row.qty, row.unit)}
                  </td>
                  <td className={FIGURE_CELL}>
                    {Number(row.variationQty) !== 0 && (
                      <>
                        <StackedLabel>{t('ordered')}</StackedLabel>
                        {qty(row.variationQty, row.unit)}
                      </>
                    )}
                  </td>
                  <td className={FIGURE_CELL}>
                    <StackedLabel>{t('measured')}</StackedLabel>
                    {qty(row.measuredQty, row.unit)}
                  </td>
                  <td className={FIGURE_CELL}>
                    <StackedLabel>{t('residual')}</StackedLabel>
                    {qty(row.residualQty, row.unit)}
                  </td>
                  <td className={FIGURE_CELL}>
                    <StackedLabel>{t('works')}</StackedLabel>
                    {row.works === null ? (
                      <span className="text-[color:var(--warn)]">{t('flagged')}</span>
                    ) : (
                      <span dir="ltr" className="font-mono tabular-nums">{m(row.works)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {view.differences.nextCursor && (
        <Button variant="secondary" size="sm" disabled={loading} onClick={onShowMore}>
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('more')}
        </Button>
      )}
    </section>
  );
}
