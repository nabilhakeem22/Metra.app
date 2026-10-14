'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { CostItemOption } from './builder-model';

/** Under a section's lines: add a line (blank or from the price book) and the subtotal. */
export function BuilderSectionFooter({
  costItems,
  onAddLine,
  sectionSubtotal,
}: {
  costItems: CostItemOption[];
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
        {costItems.length > 0 && (
          <Select
            value=""
            onValueChange={(v) => {
              const ci = costItems.find((c) => c.id === v);
              if (ci) onAddLine(ci);
            }}
          >
            <SelectTrigger className="w-auto min-w-48">
              <SelectValue placeholder={t('builder.fromPriceBook')} />
            </SelectTrigger>
            <SelectContent>
              {costItems.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.code} · {pickLocale({ nameAr: c.nameAr, nameEn: c.nameEn }, 'name', locale).value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <span className="text-body font-medium">
        {t('builder.sectionSubtotal')}:{' '}
        <span dir="ltr">{formatMoney(sectionSubtotal, locale)}</span>
      </span>
    </div>
  );
}
