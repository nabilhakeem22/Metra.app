'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  STACKED_BODY,
  STACKED_CELL,
  STACKED_HEAD,
  STACKED_LEAD_CELL,
  STACKED_ROW,
  STACKED_TABLE,
  StackedLabel,
} from '@/components/ui/stacked-table';
import type { CostSheetCost, CostSheetRow } from '@/lib/execution/money/cost-sheet-types';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';

/** A row's name: its section's title, or what the row stands for. */
function useRowName() {
  const t = useTranslations('contracts.execution.costSheet.rows');
  const locale = useLocale();
  return (row: CostSheetRow) => {
    if (row.kind === 'section') return pickLocale({ titleAr: row.titleAr, titleEn: row.titleEn }, 'title', locale).value || t('untitled');
    if (row.kind === 'more_sections') return t('kinds.more_sections', { count: formatNumber(row.count ?? 0, locale) });
    return t(`kinds.${row.kind}`);
  };
}

const FIGURE_CELL = `${STACKED_CELL} sm:text-end`;

/**
 * Budget against actual cost per section (a section's change orders inside
 * its budget), then the totals; stacked as cards on a phone (F1). A figure the
 * row does not have (no budget on cost booked to no section, no actual on
 * new-scope change orders) is left out, label and all.
 */
export function CostSheetRows({ cost, m }: { cost: CostSheetCost; m: (value: string) => string }) {
  const t = useTranslations('contracts.execution.costSheet.rows');
  const nameOf = useRowName();
  const figure = (label: string, value: string | null) =>
    value !== null && (
      <>
        <StackedLabel>{label}</StackedLabel>
        <span dir="ltr" className="font-mono tabular-nums">{m(value)}</span>
      </>
    );

  return (
    <section className="space-y-2">
      <h3 className="text-body font-semibold">{t('title')}</h3>
      <table className={STACKED_TABLE}>
        <thead className={STACKED_HEAD}>
          <tr className="border-b">
            <th className="py-2 pe-3 text-start font-medium">{t('section')}</th>
            <th className="py-2 pe-3 text-end font-medium">{t('budget')}</th>
            <th className="py-2 pe-3 text-end font-medium">{t('actual')}</th>
            <th className="py-2 text-end font-medium">{t('variance')}</th>
          </tr>
        </thead>
        <tbody className={STACKED_BODY}>
          {cost.sections.map((row, index) => (
            <tr key={row.sectionId ?? `${row.kind}-${index}`} className={STACKED_ROW}>
              <td className={STACKED_LEAD_CELL}>
                {nameOf(row)}
                {row.overBudget && <span className="ms-2 text-caption font-medium text-[color:var(--warn)]">{t('overBudget')}</span>}
              </td>
              <td className={FIGURE_CELL}>{figure(t('budget'), row.budgetCost)}</td>
              <td className={FIGURE_CELL}>{figure(t('actual'), row.actualCost)}</td>
              <td className={FIGURE_CELL}>{figure(t('variance'), row.variance)}</td>
            </tr>
          ))}
          <tr className={`${STACKED_ROW} font-semibold`}>
            <td className={STACKED_LEAD_CELL}>{t('total')}</td>
            <td className={FIGURE_CELL}>{figure(t('budget'), cost.totals.budgetCost)}</td>
            <td className={FIGURE_CELL}>{figure(t('actual'), cost.totals.actualCost)}</td>
            <td className={FIGURE_CELL} />
          </tr>
        </tbody>
      </table>
    </section>
  );
}
