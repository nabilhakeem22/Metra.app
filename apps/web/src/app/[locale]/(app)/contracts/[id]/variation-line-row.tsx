'use client';

import type { CostItemUnit } from '@metra/db';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { useUnitLabel } from '@/hooks/use-unit-label';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import { variationLinePath } from '@/lib/variations/line-fields';
import { BaselineLinePicker } from './baseline-line-picker';
import type { DraftVoLine } from './contract-vo-types';
import type { VariationCreateApi, VoLineColumn } from './use-variation-create';

/** The DOM id of one line cell (by row key); its refusal sits under it. */
export function variationLineControlId(key: string, column: VoLineColumn): string {
  return `vo-line-${key}-${column}`;
}

/**
 * One line of a new variation order: each cell labelled, its refusal under it.
 * Its contract line is picked by search (baseline-line-picker.tsx), on a line
 * of its own above the other cells.
 */
export function VariationLineRow({
  index,
  line,
  contractId,
  create,
}: {
  index: number;
  line: DraftVoLine;
  contractId: string;
  create: VariationCreateApi;
}) {
  const tv = useTranslations('variations');
  const unitLabel = useUnitLabel();
  const cell = (column: VoLineColumn) => ({
    id: variationLineControlId(line.key, column),
    ...create.errors.bind(variationLinePath(line.key, column)),
  });
  const update = (patch: Partial<DraftVoLine>) => create.updateLine(index, patch);

  return (
    <div className="flex flex-wrap items-start gap-2">
      <BaselineLinePicker
        contractId={contractId}
        field={cell('contractLineId')}
        contractLineId={line.contractLineId}
        contractLineLabel={line.contractLineLabel}
        onPick={update}
      />
      <FormField {...cell('description')} label={tv('line.description')}>
        <Input
          className="w-40"
          value={line.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </FormField>
      <FormField {...cell('qty')} label={tv('line.qty')}>
        <Input className="w-20" dir="ltr" value={line.qty} onChange={(e) => update({ qty: e.target.value })} />
      </FormField>
      <FormField {...cell('unit')} label={tv('line.unit')}>
        <SelectControl
          className="h-9 w-auto min-w-20"
          value={line.unit}
          onValueChange={(value) => update({ unit: value as CostItemUnit })}
          options={UNIT_TOKENS.map((unit) => ({ value: unit, label: unitLabel(unit) }))}
        />
      </FormField>
      <FormField {...cell('unitPrice')} label={tv('line.unitPrice')}>
        <Input
          className="w-24"
          dir="ltr"
          value={line.unitPrice}
          onChange={(e) => update({ unitPrice: e.target.value })}
        />
      </FormField>
      <button
        type="button"
        className="self-center"
        onClick={() => create.removeLine(index)}
        aria-label={tv('line.remove')}
      >
        <Trash2 className="size-4 text-muted-foreground" aria-hidden />
      </button>
    </div>
  );
}
