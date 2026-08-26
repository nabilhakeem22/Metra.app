'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SectionTotals } from '@/lib/aggregates/proposal-totals';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { addSection as recordSection } from '@/lib/sections/actions';
import { BuilderLineRow } from './builder-line-row';
import {
  type CostItemOption,
  type LineState,
  type SectionState,
} from './builder-model';
import { SectionCombobox, type SectionOption } from './section-combobox';

export function BuilderSectionCard({
  section,
  sectionIndex,
  sectionTotal,
  seeMargin,
  costItems,
  sectionLibrary,
  patchSection,
  patchLine,
  addLine,
  removeLine,
  onMoveUp,
  onMoveDown,
  onRemoveSection,
}: {
  section: SectionState;
  sectionIndex: number;
  sectionTotal: SectionTotals;
  seeMargin: boolean;
  costItems: CostItemOption[];
  sectionLibrary: SectionOption[];
  patchSection: (si: number, patch: Partial<SectionState>) => void;
  patchLine: (si: number, li: number, patch: Partial<LineState>) => void;
  addLine: (si: number, ci?: CostItemOption) => void;
  removeLine: (si: number, li: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveSection: () => void;
}) {
  const t = useTranslations('proposals');
  const th = useTranslations('hints.proposal');
  const locale = useLocale();
  const isAr = locale.startsWith('ar');
  const si = sectionIndex;
  const sec = section;
  const st = sectionTotal;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <SectionCombobox
            className="min-w-40 flex-1"
            locale={locale}
            valueEn={sec.titleEn}
            valueAr={sec.titleAr}
            options={sectionLibrary}
            placeholder={
              isAr ? t('builder.sectionTitleAr') : t('builder.sectionTitleEn')
            }
            onChange={(patch) => patchSection(si, patch)}
            onCreate={(name) => {
              // Fire-and-forget: recording the title never blocks the build.
              void recordSection(name);
            }}
            aria-describedby={`sec-hint-${si}`}
          />
          <Input
            dir={isAr ? 'ltr' : 'rtl'}
            placeholder={
              isAr ? t('builder.sectionTitleEn') : t('builder.sectionTitleAr')
            }
            value={isAr ? sec.titleEn : sec.titleAr}
            onChange={(e) =>
              patchSection(
                si,
                isAr
                  ? { titleEn: e.target.value }
                  : { titleAr: e.target.value },
              )
            }
            className="min-w-40 flex-1"
          />
          <FieldHint id={`sec-hint-${si}`} hint={th('sectionTitle')} />
          <Button variant="ghost" size="icon" aria-label={t('builder.moveUp')} onClick={onMoveUp}>
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('builder.moveDown')} onClick={onMoveDown}>
            <ArrowDown className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('builder.removeSection')} onClick={onRemoveSection}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-1 py-1 text-start font-medium">{t('builder.description')}</th>
                <th className="px-1 py-1 font-medium">
                  <span className="inline-flex items-center">
                    {t('builder.qty')}
                    <FieldHint hint={th('lineQty')} />
                  </span>
                </th>
                <th className="px-1 py-1 font-medium">{t('builder.unit')}</th>
                {seeMargin && (
                  <th className="px-1 py-1 font-medium">
                    <span className="inline-flex items-center">
                      {t('builder.unitCost')}
                      <FieldHint hint={th('lineUnitCost')} />
                    </span>
                  </th>
                )}
                <th className="px-1 py-1 font-medium">
                  <span className="inline-flex items-center">
                    {t('builder.unitPrice')}
                    <FieldHint hint={th('lineUnitPrice')} />
                  </span>
                </th>
                <th className="px-1 py-1 font-medium">
                  <span className="inline-flex items-center">
                    {t('builder.discount')}
                    <FieldHint hint={th('lineDiscountPct')} />
                  </span>
                </th>
                <th className="px-1 py-1 text-end font-medium">{t('builder.sectionSubtotal')}</th>
                <th className="px-1 py-1" />
              </tr>
            </thead>
            <tbody>
              {sec.lines.map((l, li) => (
                <BuilderLineRow
                  key={li}
                  line={l}
                  sectionIndex={si}
                  lineIndex={li}
                  seeMargin={seeMargin}
                  patchLine={patchLine}
                  removeLine={removeLine}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => addLine(si)}>
              <Plus className="size-4" aria-hidden />
              {t('builder.addLine')}
            </Button>
            {costItems.length > 0 && (
              <Select
                value=""
                onValueChange={(v) => {
                  const ci = costItems.find((c) => c.id === v);
                  if (ci) addLine(si, ci);
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
          <span className="text-sm font-medium" dir="ltr">
            {t('builder.sectionSubtotal')}: {formatMoney(st.sectionSubtotal, locale)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
