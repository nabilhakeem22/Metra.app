'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { STACKED_ACTION_CELL, STACKED_CELL, STACKED_LEAD_CELL, STACKED_ROW, StackedLabel } from '@/components/ui/stacked-table';
import type { MeasurableLine } from '@/lib/execution/measurements/queries';
import { formatDate } from '@/lib/format/date';
import { formatQuantity } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { QuantityWithUnit } from './quantity-with-unit';

const FIGURE_CELL = `${STACKED_CELL} sm:text-end`;

/** The line as the studio names it: its code, then its description. */
export function measurableLineLabel(line: Pick<MeasurableLine, 'itemCode' | 'descriptionAr' | 'descriptionEn'>, locale: string): string {
  const description = pickLocale(line, 'description', locale).value;
  return [line.itemCode, description].filter(Boolean).join(' ');
}

/** One line: its quantities (no price), its final measured quantity, and "Record" when it may be measured; a card on a phone (F1). */
export function MeasurementRow({ line, onRecord }: { line: MeasurableLine; onRecord: (() => void) | null }) {
  const t = useTranslations('contracts.execution.measurements');
  const locale = useLocale();
  const section = pickLocale({ titleAr: line.sectionTitleAr, titleEn: line.sectionTitleEn }, 'title', locale).value;
  const qty = (value: string) => <QuantityWithUnit qty={formatQuantity(value, locale)} unit={line.unit} />;

  return (
    <tr className={STACKED_ROW}>
      <td className={STACKED_LEAD_CELL}>
        <p>{measurableLineLabel(line, locale)}</p>
        <p className="text-caption text-muted-foreground">
          {section}
          {line.provisional && <span className="ms-2 font-medium text-foreground">{t('provisional')}</span>}
        </p>
      </td>
      <td className={FIGURE_CELL}>
        <StackedLabel>{t('contractQty')}</StackedLabel>
        {qty(line.qty)}
      </td>
      <td className={FIGURE_CELL}>
        {Number(line.variationQty) !== 0 && (
          <>
            <StackedLabel>{t('ordered')}</StackedLabel>
            {qty(line.variationQty)}
          </>
        )}
      </td>
      <td className={FIGURE_CELL}>
        <StackedLabel>{t('measured')}</StackedLabel>
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
      <td className={STACKED_ACTION_CELL}>
        {onRecord && (
          <Button variant="secondary" size="sm" onClick={onRecord}>
            {t('record.open')}
          </Button>
        )}
      </td>
    </tr>
  );
}
