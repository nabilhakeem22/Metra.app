'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { searchCostEntryLines } from '@/lib/execution/costs/actions';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { COST_ENTRY_CONTROL_ID } from './cost-entry-form-state';
import { MoreSectionsButton } from './more-sections-button';
import type { CostEntryFormApi } from './use-cost-entry-form';
import { useBaselineLineSearch } from './use-baseline-line-search';
import type { CostSectionsApi } from './use-cost-sections';

// Radix Select forbids an empty-string item value, so "the whole contract" and
// "no single line" ride sentinels mapped back to '' at the state boundary.
const WHOLE_CONTRACT = '__whole__';
const NO_LINE = '__no_line__';

/**
 * Where a cost is booked: a section (or the whole contract), and within it a
 * line found by search (never the whole contract in the page). Picking a line
 * picks its section; another section drops a line that is not in it. The
 * sections load a page at a time; a picked one not loaded yet (the edited
 * entry's, a found line's) stays offered under its own name.
 */
export function CostEntryTargetFields({
  contractId,
  sections,
  entry,
}: {
  contractId: string;
  sections: CostSectionsApi;
  entry: CostEntryFormApi;
}) {
  const t = useTranslations('contracts.costs');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const search = useBaselineLineSearch(searchCostEntryLines, contractId, query);
  const { form, update, errors } = entry;
  const picked =
    form.contractLineId && !search.options.some((option) => option.value === form.contractLineId)
      ? [{ value: form.contractLineId, label: form.lineLabel }]
      : [];
  const lineOptions = [{ value: NO_LINE, label: t('form.noLine') }, ...picked, ...search.options];
  const title = (ar: string | null, en: string | null) => pickLocale({ nameAr: ar, nameEn: en }, 'name', locale).value;
  const loadedSections = sections.sections.map((section) => ({ value: section.id, label: title(section.titleAr, section.titleEn) }));
  const pickedSection =
    form.contractSectionId && !loadedSections.some((option) => option.value === form.contractSectionId)
      ? [{ value: form.contractSectionId, label: form.sectionLabel }]
      : [];
  const sectionOptions = [{ value: WHOLE_CONTRACT, label: t('wholeContract') }, ...pickedSection, ...loadedSections];

  const pickSection = (value: string) =>
    update({
      contractSectionId: value === WHOLE_CONTRACT ? '' : value,
      sectionLabel: sectionOptions.find((option) => option.value === value)?.label ?? '',
      contractLineId: '',
      lineLabel: '',
    });
  const pickLine = (value: string) => {
    if (value === NO_LINE) return update({ contractLineId: '', lineLabel: '' });
    const line = search.lines.find((option) => option.id === value);
    update({
      contractLineId: value,
      lineLabel: lineOptions.find((option) => option.value === value)?.label ?? '',
      ...(line ? { contractSectionId: line.sectionId, sectionLabel: title(line.sectionTitleAr, line.sectionTitleEn) } : {}),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <FormField id={COST_ENTRY_CONTROL_ID.contractSectionId} label={t('form.section')} {...errors.bind('contractSectionId')}>
          <SelectControl className="h-9 w-auto min-w-40" value={form.contractSectionId || WHOLE_CONTRACT} onValueChange={pickSection} options={sectionOptions} />
        </FormField>
        <MoreSectionsButton sections={sections} className="self-end" />
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <FormField id="ce-line-find" label={t('form.findLine')} error={search.failure ?? undefined}>
          <Input className="w-40" value={query} onChange={(event) => setQuery(event.target.value)} />
        </FormField>
        <FormField id={COST_ENTRY_CONTROL_ID.contractLineId} label={t('form.line')} {...errors.bind('contractLineId')}>
          <SelectControl className="h-9 w-auto min-w-40" value={form.contractLineId || NO_LINE} onValueChange={pickLine} options={lineOptions} />
        </FormField>
        {search.hasMore && (
          <Button size="sm" variant="secondary" className="self-end" disabled={search.loadingMore} onClick={search.loadMore}>
            {search.loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('form.moreLines')}
          </Button>
        )}
      </div>
      {search.hasMore && search.browsing && (
        <p className="text-caption text-muted-foreground">{t('form.linesCapped', { count: formatNumber(search.options.length, locale) })}</p>
      )}
    </div>
  );
}
