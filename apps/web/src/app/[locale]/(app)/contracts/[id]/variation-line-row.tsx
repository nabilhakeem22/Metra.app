'use client';

import type { CostItemUnit } from '@metra/db';
import { Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { formatNumber } from '@/lib/format/number';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import { variationLinePath } from '@/lib/variations/line-fields';
import type { DraftVoLine } from './contract-vo-types';
import { useBaselineLineSearch } from './use-baseline-line-search';
import type { VariationCreateApi, VoLineColumn } from './use-variation-create';

// Radix Select forbids an empty-string item value, so the "net delta" choice
// (stored as '' on the line) rides a sentinel that is mapped back to '' at the
// state boundary: the persisted contractLineId stays byte-identical.
const NET_DELTA = '__net_delta__';

/** The DOM id of one line cell (by row key); its refusal sits under it. */
export function variationLineControlId(key: string, column: VoLineColumn): string {
  return `vo-line-${key}-${column}`;
}

/**
 * One line of a new variation order: each cell labelled, its refusal under it.
 * Its contract line is found by searching (use-baseline-line-search.ts), so the
 * picker never holds the whole contract; a failed search is said under the box.
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
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const search = useBaselineLineSearch(contractId, query);
  const picked =
    line.contractLineId && !search.options.some((option) => option.value === line.contractLineId)
      ? [{ value: line.contractLineId, label: line.contractLineLabel }]
      : [];
  const cell = (column: VoLineColumn) => ({
    id: variationLineControlId(line.key, column),
    ...create.errors.bind(variationLinePath(line.key, column)),
  });
  const update = (patch: Partial<DraftVoLine>) => create.updateLine(index, patch);
  const pickBaseline = (value: string) =>
    update(
      value === NET_DELTA
        ? { contractLineId: '', contractLineLabel: '' }
        : {
            contractLineId: value,
            contractLineLabel: search.options.find((option) => option.value === value)?.label ?? '',
          },
    );

  return (
    <div className="flex flex-wrap items-start gap-2">
      <FormField
        id={`${variationLineControlId(line.key, 'contractLineId')}-find`}
        label={tv('line.find')}
        error={search.failure}
      >
        <Input className="w-40" value={query} onChange={(e) => setQuery(e.target.value)} />
      </FormField>
      <FormField {...cell('contractLineId')} label={tv('line.baseline')}>
        <SelectControl
          className="h-9 w-auto min-w-40"
          value={line.contractLineId || NET_DELTA}
          onValueChange={pickBaseline}
          options={[{ value: NET_DELTA, label: tv('netDelta') }, ...picked, ...search.options]}
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
      {search.capped && (
        <p className="basis-full text-caption text-muted-foreground">
          {tv('line.capped', { count: formatNumber(search.options.length, locale) })}
        </p>
      )}
    </div>
  );
}
