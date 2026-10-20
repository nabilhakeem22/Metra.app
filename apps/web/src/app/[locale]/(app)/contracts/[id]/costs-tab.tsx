'use client';

import type { ContractStatus } from '@metra/db';
import { Loader2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { SelectControl } from '@/components/ui/select-control';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ContractSectionSummary } from '@/lib/contracts/queries';
import { voidCostEntry } from '@/lib/execution/costs/actions';
import { COST_ENTRY_CATEGORIES, type CostEntryRow as CostEntry } from '@/lib/execution/costs/types';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { CostEntryForm } from './cost-entry-form';
import { CostEntryRow } from './cost-entry-row';
import { useCostEntries } from './use-cost-entries';
import { useCostEntryForm } from './use-cost-entry-form';

const ALL = '__all__';

/**
 * The Costs tab (المصروفات) of an execution contract: what was recorded, 50 at
 * a time newest first (asked when the tab opens), narrowed by category or
 * section, with the live total of what is shown; record, edit and void for a
 * role that may, each followed by the list asked again.
 */
export function CostsTab({
  contractId,
  contractStatus,
  sections,
  canCreate,
  canUpdate,
  m,
}: {
  contractId: string;
  contractStatus: ContractStatus;
  sections: ContractSectionSummary[];
  canCreate: boolean;
  canUpdate: boolean;
  m: (value: string) => string;
}) {
  const t = useTranslations('contracts.costs');
  const te = useTranslations('errors');
  const locale = useLocale();
  const list = useCostEntries(contractId);
  const entry = useCostEntryForm(contractId, list.reload);
  const { confirm, dialog } = useConfirm();
  const [voiding, startVoid] = useTransition();
  const filtered = list.filter.category !== null || list.filter.sectionId !== null;
  // A draft contract takes no cost yet (the cores answer contract_not_issued).
  const canRecord = canCreate && contractStatus !== 'draft';

  async function askVoid(target: CostEntry) {
    const sure = await confirm({ title: t('voidConfirm.title'), description: t('voidConfirm.description'), confirmLabel: t('voidConfirm.confirm'), cancelLabel: t('voidConfirm.cancel'), variant: 'destructive' });
    if (!sure) return;
    startVoid(async () => {
      try {
        const result = await voidCostEntry(target.id);
        toast(result.ok ? { title: t('toast.voided') } : { title: describeFailure(result, te), variant: 'destructive' });
        list.reload();
      } catch (rejection) {
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      }
    });
  }

  return (
    <div className="space-y-4">
      {dialog}
      {(canCreate || canUpdate) && <CostEntryForm contractId={contractId} sections={sections} entry={entry} />}
      <p className="text-body text-muted-foreground">{t('intro')}</p>
      {canCreate && !canRecord && <p className="text-body text-muted-foreground">{t('draftNote')}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-caption">
          <span>{t('filterCategory')}</span>
          <SelectControl
            id="costs-filter-category"
            className="h-9 w-40"
            value={list.filter.category ?? ALL}
            onValueChange={(value) => list.applyFilter({ ...list.filter, category: value === ALL ? null : (value as CostEntry['category']) })}
            options={[{ value: ALL, label: t('all') }, ...COST_ENTRY_CATEGORIES.map((category) => ({ value: category, label: t(`categories.${category}`) }))]}
          />
        </label>
        <label className="space-y-1 text-caption">
          <span>{t('filterSection')}</span>
          <SelectControl
            id="costs-filter-section"
            className="h-9 w-48"
            value={list.filter.sectionId ?? ALL}
            onValueChange={(value) => list.applyFilter({ ...list.filter, sectionId: value === ALL ? null : value })}
            options={[{ value: ALL, label: t('all') }, ...sections.map((section) => ({ value: section.id, label: pickLocale({ nameAr: section.titleAr, nameEn: section.titleEn }, 'name', locale).value }))]}
          />
        </label>
        {list.totals && (
          <dl className="ms-auto flex gap-4 text-body">
            <div><dt className="text-caption text-muted-foreground">{t('total')}</dt><dd className="font-mono tabular-nums" dir="ltr">{m(list.totals.amount)}</dd></div>
            <div><dt className="text-caption text-muted-foreground">{t('entries')}</dt><dd className="tabular-nums" dir="ltr">{formatNumber(list.totals.count, locale)}</dd></div>
          </dl>
        )}
        {canRecord && (
          <Button size="sm" variant="default" onClick={entry.openNew}>
            <Plus className="size-4" aria-hidden />
            {t('record')}
          </Button>
        )}
      </div>
      {list.failure && <p className="text-body text-destructive" role="alert">{list.failure}</p>}
      <Card aria-busy={list.pending}>
        <CardContent className="overflow-x-auto p-0">
          {list.entries.length === 0 ? (
            // A first load that failed says so above (the alert), not "loading" for ever.
            !(list.failure && !list.loaded) && (
              <p className="py-6 text-center text-body text-muted-foreground">{t(!list.loaded ? 'loading' : filtered ? 'noMatch' : 'empty')}</p>
            )
          ) : (
            <table className="w-full text-body">
              <tbody>
                {list.entries.map((row) => (
                  <CostEntryRow key={row.id} entry={row} m={m} canUpdate={canUpdate} pending={voiding} onEdit={entry.openEdit} onVoid={askVoid} />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      {list.hasMore && (
        <Button size="sm" variant="secondary" disabled={list.pending} onClick={list.loadMore}>
          {list.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('showMore')}
        </Button>
      )}
      {list.entries.some((row) => row.market !== null) && <p className="text-caption text-muted-foreground">{t('marketNote')}</p>}
    </div>
  );
}
