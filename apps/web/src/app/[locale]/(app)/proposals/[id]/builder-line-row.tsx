'use client';

import { Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { BOQ_UNITS } from '@/lib/boqs/edit-input';
import { formatMoney } from '@/lib/format/money';
import { FigureInput } from './figure-input';
import { INPUT_CLASS, previewLine, type LineState } from './builder-model';
import { CellError, cellA11y } from './draft-cell';
import type { LineCell } from './draft-field-errors';
import type { LineFigure } from './draft-completeness';
import type { DraftCellError } from './use-draft-field-errors';

const FIGURE_WIDTH: Record<LineFigure, string> = {
  qty: 'w-16',
  unitCost: 'w-20',
  unitPrice: 'w-20',
  discountPct: 'w-14',
};

/**
 * One builder line. A cell the last save was refused for is marked, with its
 * sentence under it; typing in it clears that cell's refusal only (D3).
 */
export function BuilderLineRow({
  line,
  sectionIndex,
  lineIndex,
  seeMargin,
  patchLine,
  removeLine,
  cellOf,
}: {
  line: LineState;
  sectionIndex: number;
  lineIndex: number;
  seeMargin: boolean;
  patchLine: (si: number, li: number, patch: Partial<LineState>) => void;
  removeLine: (si: number, li: number) => void;
  cellOf: (cell: LineCell) => DraftCellError;
}) {
  const t = useTranslations('proposals');
  const locale = useLocale();
  const si = sectionIndex;
  const li = lineIndex;
  const lt = previewLine(line);
  const idOf = (cell: LineCell) => `line-${line.key}-${cell}`;
  const edit = (cell: LineCell, patch: Partial<LineState>) => {
    cellOf(cell).clear();
    patchLine(si, li, patch);
  };
  const figure = (cell: LineFigure) => (
    <td className="px-1 py-1 align-top">
      <FigureInput
        id={idOf(cell)}
        data-draft-input={cell}
        value={line[cell]}
        onValueChange={(v) => edit(cell, { [cell]: v })}
        className={`${INPUT_CLASS} ${FIGURE_WIDTH[cell]}`}
        {...cellA11y(idOf(cell), cellOf(cell))}
      />
      <CellError id={idOf(cell)} error={cellOf(cell)} />
    </td>
  );

  return (
    <tr className="border-t" data-draft-line={`${si}-${li}`}>
      <td className="px-1 py-1 align-top">
        <Input
          id={idOf('description')}
          dir="ltr"
          data-draft-input="description"
          value={line.descriptionEn}
          onChange={(e) => edit('description', { descriptionEn: e.target.value })}
          className={INPUT_CLASS}
          {...cellA11y(idOf('description'), cellOf('description'))}
        />
        <CellError id={idOf('description')} error={cellOf('description')} />
      </td>
      {figure('qty')}
      <td className="px-1 py-1 align-top">
        <SelectControl
          id={idOf('unit')}
          className="h-9 w-auto min-w-16"
          value={line.unit}
          onValueChange={(v) => edit('unit', { unit: v })}
          options={BOQ_UNITS.map((u) => ({ value: u, label: u }))}
          {...cellA11y(idOf('unit'), cellOf('unit'))}
        />
        <CellError id={idOf('unit')} error={cellOf('unit')} />
      </td>
      {seeMargin && figure('unitCost')}
      {figure('unitPrice')}
      {figure('discountPct')}
      <td className="px-1 py-1 text-end align-top" dir="ltr">{formatMoney(lt.lineTotal, locale)}</td>
      <td className="px-1 py-1 align-top">
        <Button variant="ghost" size="icon" aria-label={t('builder.removeLine')} onClick={() => removeLine(si, li)}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </td>
    </tr>
  );
}
