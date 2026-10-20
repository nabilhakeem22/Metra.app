'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { searchBaselineLines } from '@/lib/contracts/lines-actions';
import { formatNumber } from '@/lib/format/number';
import { useBaselineLineSearch } from './use-baseline-line-search';

// Radix Select forbids an empty-string item value, so the "net delta" choice
// (stored as '' on the line) rides a sentinel that is mapped back to '' at the
// state boundary: the persisted contractLineId stays byte-identical.
const NET_DELTA = '__net_delta__';

type BoundField = Omit<ComponentProps<typeof FormField>, 'label' | 'children'>;

/**
 * Which contract line a variation line changes: found by searching the line
 * and its section (use-baseline-line-search.ts), never the whole contract in
 * the page. "More results" pages on, so every line can be picked. The line
 * picked stays offered whatever is searched next. A failed search is said under
 * the search box; a refused pick under the select (`field`).
 */
export function BaselineLinePicker({
  contractId,
  field,
  contractLineId,
  contractLineLabel,
  onPick,
}: {
  contractId: string;
  field: BoundField;
  contractLineId: string;
  contractLineLabel: string;
  onPick: (picked: { contractLineId: string; contractLineLabel: string }) => void;
}) {
  const tv = useTranslations('variations');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const search = useBaselineLineSearch(searchBaselineLines, contractId, query);
  const picked =
    contractLineId && !search.options.some((option) => option.value === contractLineId)
      ? [{ value: contractLineId, label: contractLineLabel }]
      : [];
  const options = [...picked, ...search.options];
  const pick = (value: string) =>
    onPick(
      value === NET_DELTA
        ? { contractLineId: '', contractLineLabel: '' }
        : { contractLineId: value, contractLineLabel: options.find((option) => option.value === value)?.label ?? '' },
    );

  return (
    <div className="flex basis-full flex-wrap items-start gap-2">
      <FormField id={`${field.id}-find`} label={tv('line.find')} error={search.failure}>
        <Input className="w-40" value={query} onChange={(e) => setQuery(e.target.value)} />
      </FormField>
      <FormField {...field} label={tv('line.baseline')}>
        <SelectControl
          className="h-9 w-auto min-w-40"
          value={contractLineId || NET_DELTA}
          onValueChange={pick}
          options={[{ value: NET_DELTA, label: tv('netDelta') }, ...options]}
        />
      </FormField>
      {search.hasMore && (
        <Button
          size="sm"
          variant="secondary"
          className="self-end"
          disabled={search.loadingMore}
          onClick={search.loadMore}
        >
          {search.loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tv('line.more')}
        </Button>
      )}
      {search.hasMore && search.browsing && (
        <p className="basis-full text-caption text-muted-foreground">
          {tv('line.capped', { count: formatNumber(search.options.length, locale) })}
        </p>
      )}
    </div>
  );
}
