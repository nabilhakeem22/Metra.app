'use client';

import type { CostItemUnit } from '@metra/db';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import { variationLinePath } from '@/lib/variations/line-fields';
import type { BaselineLine, DraftVoLine } from './contract-vo-types';
import type { VariationCreateApi, VoLineColumn } from './use-variation-create';

// Radix Select forbids an empty-string item value, so the "net delta" choice
// (stored as '' on the line) rides a sentinel that is mapped back to '' at the
// state boundary: the persisted contractLineId stays byte-identical.
const NET_DELTA = '__net_delta__';

/** The DOM id of one line cell; its refusal sits under it. */
export function variationLineControlId(index: number, column: VoLineColumn): string {
  return `vo-line-${index}-${column}`;
}

/** One line of a new variation order: each cell labelled, its refusal under it. */
export function VariationLineRow({
  index,
  line,
  baselineLines,
  create,
}: {
  index: number;
  line: DraftVoLine;
  baselineLines: BaselineLine[];
  create: VariationCreateApi;
}) {
  const tv = useTranslations('variations');
  const cell = (column: VoLineColumn) => ({
    id: variationLineControlId(index, column),
    ...create.errors.bind(variationLinePath(index, column)),
  });
  const update = (patch: Partial<DraftVoLine>) => create.updateLine(index, patch);

  return (
    <div className="flex flex-wrap items-start gap-2">
      <FormField {...cell('contractLineId')} label={tv('line.baseline')}>
        <SelectControl
          className="h-9 w-auto min-w-40"
          value={line.contractLineId || NET_DELTA}
          onValueChange={(value) => update({ contractLineId: value === NET_DELTA ? '' : value })}
          options={[
            { value: NET_DELTA, label: tv('netDelta') },
            ...baselineLines.map((baseline) => ({ value: baseline.id, label: baseline.label })),
          ]}
        />
      </FormField>
      <FormField {...cell('description')} label={tv('line.description')}>
        <Input
          className="w-40"
          value={line.descriptionEn}
          onChange={(e) => update({ descriptionEn: e.target.value })}
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
          options={UNIT_TOKENS.map((unit) => ({ value: unit, label: unit }))}
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
