'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CostSheet, CostSheetRow } from '@/lib/execution/money/cost-sheet-types';
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

const figure = (value: string | null, m: (value: string) => string) =>
  value === null ? null : <span dir="ltr" className="font-mono tabular-nums">{m(value)}</span>;

/** Budget against actual cost per section (a section's change orders inside its budget), then the totals. */
export function CostSheetRows({ sheet, m }: { sheet: CostSheet; m: (value: string) => string }) {
  const t = useTranslations('contracts.execution.costSheet.rows');
  const nameOf = useRowName();

  return (
    <section className="space-y-2">
      <h3 className="text-body font-semibold">{t('title')}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead className="text-caption text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pe-3 text-start font-medium">{t('section')}</th>
              <th className="py-2 pe-3 text-end font-medium">{t('budget')}</th>
              <th className="py-2 pe-3 text-end font-medium">{t('actual')}</th>
              <th className="py-2 text-end font-medium">{t('variance')}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.sections.map((row, index) => (
              <tr key={row.sectionId ?? `${row.kind}-${index}`} className="border-b align-top">
                <td className="py-2 pe-3">
                  {nameOf(row)}
                  {row.overBudget && <span className="ms-2 text-caption font-medium text-[color:var(--warn)]">{t('overBudget')}</span>}
                </td>
                <td className="py-2 pe-3 text-end">{figure(row.budgetCost, m)}</td>
                <td className="py-2 pe-3 text-end">{figure(row.actualCost, m)}</td>
                <td className="py-2 text-end">{figure(row.variance, m)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 pe-3">{t('total')}</td>
              <td className="py-2 pe-3 text-end">{figure(sheet.totals.budgetCost, m)}</td>
              <td className="py-2 pe-3 text-end">{figure(sheet.totals.actualCost, m)}</td>
              <td className="py-2" />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
