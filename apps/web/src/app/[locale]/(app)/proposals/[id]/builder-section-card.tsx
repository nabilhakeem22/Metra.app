'use client';

import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fieldErrorId } from '@/components/ui/field-error-text';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import type { SectionTotals } from '@/lib/aggregates/proposal-totals';
import { addSection as recordSection } from '@/lib/sections/actions';
import { BuilderLineRow } from './builder-line-row';
import { BuilderLineTableHead } from './builder-line-table-head';
import type { CostItemOption, LineState, SectionState } from './builder-model';
import { BuilderSectionFooter } from './builder-section-footer';
import { CellError, cellA11y } from './draft-cell';
import { linePath, sectionPath } from './draft-field-errors';
import { SectionCombobox, type SectionOption } from './section-combobox';
import type { DraftFieldErrorsApi } from './use-draft-field-errors';

/**
 * One builder section: its bilingual title, its lines and the add-line footer.
 * A title the last save was refused for is said under the title row; a refused
 * cell under its cell (draft-field-errors.ts).
 */
export function BuilderSectionCard({
  section,
  sectionIndex,
  sectionTotal,
  seeMargin,
  hasPriceBook,
  sectionLibrary,
  patchSection,
  patchLine,
  addLine,
  removeLine,
  onMoveUp,
  onMoveDown,
  onRemoveSection,
  cells,
}: {
  section: SectionState;
  sectionIndex: number;
  sectionTotal: SectionTotals;
  seeMargin: boolean;
  hasPriceBook: boolean;
  sectionLibrary: SectionOption[];
  patchSection: (si: number, patch: Partial<SectionState>) => void;
  patchLine: (si: number, li: number, patch: Partial<LineState>) => void;
  addLine: (si: number, ci?: CostItemOption) => void;
  removeLine: (si: number, li: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveSection: () => void;
  /** The cell refusals of the last save (use-draft-field-errors.ts). */
  cells: DraftFieldErrorsApi;
}) {
  const t = useTranslations('proposals');
  const th = useTranslations('hints.proposal');
  const locale = useLocale();
  const isAr = locale.startsWith('ar');
  const si = sectionIndex;
  const sec = section;
  const name = cells.cell(sectionPath(sec.key));
  const nameId = `section-${sec.key}-name`;
  const rename = (patch: Partial<SectionState>) => {
    name.clear();
    patchSection(si, patch);
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2" data-draft-section={si}>
          <SectionCombobox
            className="min-w-40 flex-1"
            locale={locale}
            valueEn={sec.titleEn}
            valueAr={sec.titleAr}
            options={sectionLibrary}
            placeholder={isAr ? t('builder.sectionTitleAr') : t('builder.sectionTitleEn')}
            onChange={rename}
            onCreate={(created) => {
              // Fire-and-forget: recording the title never blocks the build.
              void recordSection(created);
            }}
            aria-describedby={
              name.message ? `sec-hint-${si} ${fieldErrorId(nameId)}` : `sec-hint-${si}`
            }
          />
          <Input
            dir={isAr ? 'ltr' : 'rtl'}
            placeholder={isAr ? t('builder.sectionTitleEn') : t('builder.sectionTitleAr')}
            value={isAr ? sec.titleEn : sec.titleAr}
            onChange={(e) => rename(isAr ? { titleEn: e.target.value } : { titleAr: e.target.value })}
            className="min-w-40 flex-1"
            {...cellA11y(nameId, name)}
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
        <CellError id={nameId} error={name} />

        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <BuilderLineTableHead seeMargin={seeMargin} />
            <tbody>
              {sec.lines.map((l, li) => (
                <BuilderLineRow
                  key={l.key}
                  line={l}
                  sectionIndex={si}
                  lineIndex={li}
                  seeMargin={seeMargin}
                  patchLine={patchLine}
                  removeLine={removeLine}
                  cellOf={(cell) => cells.cell(linePath(l.key, cell))}
                />
              ))}
            </tbody>
          </table>
        </div>

        <BuilderSectionFooter
          hasPriceBook={hasPriceBook}
          sections={sectionLibrary}
          onAddLine={(ci) => addLine(si, ci)}
          sectionSubtotal={sectionTotal.sectionSubtotal}
        />
      </CardContent>
    </Card>
  );
}
