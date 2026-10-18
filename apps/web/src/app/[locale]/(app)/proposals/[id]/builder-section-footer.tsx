'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format/money';
import type { CostItemOption } from './builder-model';
import { PriceBookPicker } from './price-book-picker';
import type { SectionOption } from './section-combobox';

/** Under a section's lines: add a line (blank or from the price book) and the subtotal. */
export function BuilderSectionFooter({
  hasPriceBook,
  sections,
  onAddLine,
  sectionSubtotal,
}: {
  hasPriceBook: boolean;
  sections: SectionOption[];
  onAddLine: (costItem?: CostItemOption) => void;
  sectionSubtotal: string;
}) {
  const t = useTranslations('proposals');
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onAddLine()}>
          <Plus className="size-4" aria-hidden />
          {t('builder.addLine')}
        </Button>
        {hasPriceBook && <PriceBookPicker sections={sections} onPick={onAddLine} />}
      </div>
      <span className="text-body font-medium">
        {t('builder.sectionSubtotal')}:{' '}
        <span dir="ltr">{formatMoney(sectionSubtotal, locale)}</span>
      </span>
    </div>
  );
}
