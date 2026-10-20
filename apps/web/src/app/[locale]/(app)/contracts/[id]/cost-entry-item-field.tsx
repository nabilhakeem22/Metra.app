'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
// The builder's price book search: the same server action, budget and answer cache.
import { usePriceBookSearch } from '@/app/[locale]/(app)/proposals/[id]/use-price-book-search';
import { COST_ENTRY_CONTROL_ID } from './cost-entry-form-state';
import { costItemLabel } from './cost-entry-labels';
import type { CostEntryFormApi } from './use-cost-entry-form';

const NO_ITEM = '__no_item__';

/**
 * The price book item a cost is for, found by search: optional, and what lets
 * the list show the item's market price beside the cost (when the entry's
 * quantity is in the market item's unit). The picked item stays offered
 * whatever is searched next. A role that may not search the price book (a
 * site engineer, an accountant) sees the entry's item, kept as it is.
 */
export function CostEntryItemField({ entry, canSearch }: { entry: CostEntryFormApi; canSearch: boolean }) {
  const t = useTranslations('contracts.costs.form');
  if (!canSearch) {
    return (
      <FormField id={COST_ENTRY_CONTROL_ID.costItemId} label={t('costItem')} {...entry.errors.bind('costItemId')}>
        <Input readOnly className="w-auto min-w-40" value={entry.form.costItemLabel || t('noCostItem')} />
      </FormField>
    );
  }
  return <CostItemSearchField entry={entry} />;
}

function CostItemSearchField({ entry }: { entry: CostEntryFormApi }) {
  const t = useTranslations('contracts.costs.form');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const { search, failure } = usePriceBookSearch(entry.open, query, locale);
  const { form, update, errors } = entry;
  const found = (search?.items ?? []).map((item) => ({
    value: item.id,
    label: costItemLabel({ costItemCode: item.code, costItemNameAr: item.nameAr, costItemNameEn: item.nameEn }, locale),
  }));
  const picked = form.costItemId && !found.some((option) => option.value === form.costItemId) ? [{ value: form.costItemId, label: form.costItemLabel }] : [];
  const options = [{ value: NO_ITEM, label: t('noCostItem') }, ...picked, ...found];

  const pick = (value: string) => {
    if (value === NO_ITEM) return update({ costItemId: '', costItemLabel: '' });
    update({ costItemId: value, costItemLabel: options.find((option) => option.value === value)?.label ?? '' });
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      <FormField id="ce-item-find" label={t('findCostItem')} error={failure ?? undefined}>
        <Input className="w-40" value={query} onChange={(event) => setQuery(event.target.value)} />
      </FormField>
      <FormField id={COST_ENTRY_CONTROL_ID.costItemId} label={t('costItem')} hint={t('costItemHint')} {...errors.bind('costItemId')}>
        <SelectControl className="h-9 w-auto min-w-40" value={form.costItemId || NO_ITEM} onValueChange={pick} options={options} />
      </FormField>
    </div>
  );
}
