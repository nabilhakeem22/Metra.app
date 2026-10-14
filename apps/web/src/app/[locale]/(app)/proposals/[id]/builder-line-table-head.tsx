'use client';

import { useTranslations } from 'next-intl';
import { FieldHint } from '@/components/ui/field-hint';

/** The column heads of a section's line table, with the hint beside each figure. */
export function BuilderLineTableHead({ seeMargin }: { seeMargin: boolean }) {
  const t = useTranslations('proposals');
  const th = useTranslations('hints.proposal');
  const hinted = (label: string, hint: string) => (
    <th className="px-1 py-1 font-medium">
      <span className="inline-flex items-center">
        {label}
        <FieldHint hint={hint} />
      </span>
    </th>
  );
  return (
    <thead>
      <tr className="text-caption text-muted-foreground">
        <th className="px-1 py-1 text-start font-medium">{t('builder.description')}</th>
        {hinted(t('builder.qty'), th('lineQty'))}
        <th className="px-1 py-1 font-medium">{t('builder.unit')}</th>
        {seeMargin && hinted(t('builder.unitCost'), th('lineUnitCost'))}
        {hinted(t('builder.unitPrice'), th('lineUnitPrice'))}
        {hinted(t('builder.discount'), th('lineDiscountPct'))}
        <th className="px-1 py-1 text-end font-medium">{t('builder.sectionSubtotal')}</th>
        <th className="px-1 py-1" />
      </tr>
    </thead>
  );
}
