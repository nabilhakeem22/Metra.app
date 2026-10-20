'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { FinalAccountView } from '@/lib/execution/final-account/load';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { formatMeasuredQty, measurableLineLabel } from './measurement-row';

/**
 * The lines whose final measured quantity differs from the contract quantity
 * plus what change orders ordered (50 at a time, document order): a
 * provisional one with the works its difference bills (D2a), a firm one
 * flagged as needing a change order. Counts of each kind head the list.
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

  return (
    <section className="space-y-2">
      <h3 className="text-body font-semibold">{t('title')}</h3>
      {view.differences.rows.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <p className="text-caption text-muted-foreground">{t('counts', { billed: count(view.counts.billed), flagged: count(view.counts.flagged) })}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="text-caption text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pe-3 text-start font-medium">{t('line')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('qty')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('ordered')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('measured')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('residual')}</th>
                  <th className="py-2 text-end font-medium">{t('works')}</th>
                </tr>
              </thead>
              <tbody>
                {view.differences.rows.map((row) => (
                  <tr key={row.lineId} className="border-b align-top last:border-0">
                    <td className="py-2 pe-3">
                      <p>{measurableLineLabel(row, locale)}</p>
                      <p className="text-caption text-muted-foreground">
                        {pickLocale({ titleAr: row.sectionTitleAr, titleEn: row.sectionTitleEn }, 'title', locale).value}
                      </p>
                    </td>
                    <td className="py-2 pe-3 text-end">{qty(row.qty, row.unit)}</td>
                    <td className="py-2 pe-3 text-end">{Number(row.variationQty) === 0 ? null : qty(row.variationQty, row.unit)}</td>
                    <td className="py-2 pe-3 text-end">{qty(row.measuredQty, row.unit)}</td>
                    <td className="py-2 pe-3 text-end">{qty(row.residualQty, row.unit)}</td>
                    <td className="py-2 text-end">
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
          </div>
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
