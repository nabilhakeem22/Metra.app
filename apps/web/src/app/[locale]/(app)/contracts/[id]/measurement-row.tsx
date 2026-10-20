'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { MeasurableLine } from '@/lib/execution/measurements/queries';
import { formatDate } from '@/lib/format/date';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';

/** A quantity as stored (up to 4 decimals), Latin digits, nothing rounded away. */
export function formatMeasuredQty(value: string, locale: string): string {
  return formatNumber(value, locale, { maximumFractionDigits: 4 });
}

/** The line as the studio names it: its code, then its description. */
export function measurableLineLabel(line: Pick<MeasurableLine, 'itemCode' | 'descriptionAr' | 'descriptionEn'>, locale: string): string {
  const description = pickLocale(line, 'description', locale).value;
  return [line.itemCode, description].filter(Boolean).join(' ');
}

/** One line: its quantities (no price), its final measured quantity, and "Record" when it may be measured. */
export function MeasurementRow({ line, onRecord }: { line: MeasurableLine; onRecord: (() => void) | null }) {
  const t = useTranslations('contracts.execution.measurements');
  const locale = useLocale();
  const section = pickLocale({ titleAr: line.sectionTitleAr, titleEn: line.sectionTitleEn }, 'title', locale).value;
  const qty = (value: string) => (
    <span dir="ltr" className="font-mono tabular-nums">
      {formatMeasuredQty(value, locale)} {line.unit}
    </span>
  );

  return (
    <tr className="border-b align-top last:border-0">
      <td className="py-2 pe-3">
        <p>{measurableLineLabel(line, locale)}</p>
        <p className="text-caption text-muted-foreground">
          {section}
          {line.provisional && <span className="ms-2 font-medium text-foreground">{t('provisional')}</span>}
        </p>
      </td>
      <td className="py-2 pe-3 text-end">{qty(line.qty)}</td>
      <td className="py-2 pe-3 text-end">{Number(line.variationQty) === 0 ? null : qty(line.variationQty)}</td>
      <td className="py-2 pe-3 text-end">
        {line.latest ? (
          <>
            <p className="font-semibold">{qty(line.latest.measuredQty)}</p>
            <p className="text-caption text-muted-foreground">{t('measuredOn', { date: formatDate(line.latest.measuredOn, locale) })}</p>
            {line.latest.note && <p className="text-caption text-muted-foreground">{line.latest.note}</p>}
          </>
        ) : (
          <span className="text-muted-foreground">{t('notMeasured')}</span>
        )}
      </td>
      <td className="py-2 text-end">
        {onRecord && (
          <Button variant="secondary" size="sm" onClick={onRecord}>
            {t('record.open')}
          </Button>
        )}
      </td>
    </tr>
  );
}
