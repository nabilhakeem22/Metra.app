'use client';

import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import type { ContractSectionSummary } from '@/lib/contracts/queries';
import type { CostEntryField } from '@/lib/execution/costs/input';
import { COST_ENTRY_CATEGORIES } from '@/lib/execution/costs/types';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import { COST_ENTRY_CONTROL_ID, type CostEntryFormState } from './cost-entry-form-state';
import { CostEntryItemField } from './cost-entry-item-field';
import { CostEntryTargetFields } from './cost-entry-target-fields';
import type { CostEntryFormApi } from './use-cost-entry-form';

const NO_UNIT = '__no_unit__';

type TextKey = 'description' | 'amount' | 'qty' | 'unitCost' | 'supplier' | 'reference';

/**
 * Record or edit one cost. Every refusal is said under its box: the typed
 * ones on Save, the server's (a line no longer in its section, an item
 * deleted meanwhile) when it answers; one that belongs to no box above Save.
 */
export function CostEntryForm({
  contractId,
  sections,
  entry,
}: {
  contractId: string;
  sections: ContractSectionSummary[];
  entry: CostEntryFormApi;
}) {
  const t = useTranslations('contracts.costs');
  const tp = useTranslations('priceBook');
  const tc = useTranslations('common');
  const { form, update, errors } = entry;
  const box = (key: TextKey & CostEntryField, numeric = false) => (
    <Input
      dir={numeric ? 'ltr' : undefined}
      inputMode={numeric ? 'decimal' : undefined}
      value={form[key]}
      onChange={(event) => update({ [key]: event.target.value } as Partial<CostEntryFormState>)}
    />
  );

  return (
    <FormSheet
      open={entry.open}
      onOpenChange={entry.setOpen}
      title={t(entry.editing ? 'form.editTitle' : 'form.newTitle')}
      onSubmit={entry.submit}
      submitLabel={t('form.save')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={entry.pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id={COST_ENTRY_CONTROL_ID.category} label={t('form.category')} required {...errors.bind('category')}>
          <SelectControl
            value={form.category}
            onValueChange={(category) => update({ category: category as CostEntryFormState['category'] })}
            options={COST_ENTRY_CATEGORIES.map((category) => ({ value: category, label: t(`categories.${category}`) }))}
          />
        </FormField>
        <FormField id={COST_ENTRY_CONTROL_ID.incurredOn} label={t('form.incurredOn')} required {...errors.bind('incurredOn')}>
          <Input type="date" dir="ltr" value={form.incurredOn} onChange={(event) => update({ incurredOn: event.target.value })} />
        </FormField>
      </div>
      <FormField id={COST_ENTRY_CONTROL_ID.description} label={t('form.description')} required {...errors.bind('description')}>
        {box('description')}
      </FormField>
      <FormField id={COST_ENTRY_CONTROL_ID.amount} label={t('form.amount')} required {...errors.bind('amount')}>
        {box('amount', true)}
      </FormField>
      <CostEntryTargetFields contractId={contractId} sections={sections} entry={entry} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField id={COST_ENTRY_CONTROL_ID.qty} label={t('form.qty')} hint={t('form.quantityHint')} {...errors.bind('qty')}>
          {box('qty', true)}
        </FormField>
        <FormField id={COST_ENTRY_CONTROL_ID.unit} label={t('form.unit')} {...errors.bind('unit')}>
          <SelectControl
            value={form.unit || NO_UNIT}
            onValueChange={(unit) => update({ unit: unit === NO_UNIT ? '' : unit })}
            options={[{ value: NO_UNIT, label: t('form.noUnit') }, ...UNIT_TOKENS.map((unit) => ({ value: unit, label: tp(`units.${unit}`) }))]}
          />
        </FormField>
        <FormField id={COST_ENTRY_CONTROL_ID.unitCost} label={t('form.unitCost')} {...errors.bind('unitCost')}>
          {box('unitCost', true)}
        </FormField>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id={COST_ENTRY_CONTROL_ID.supplier} label={t('form.supplier')} {...errors.bind('supplier')}>
          {box('supplier')}
        </FormField>
        <FormField id={COST_ENTRY_CONTROL_ID.reference} label={t('form.reference')} hint={t('form.referenceHint')} {...errors.bind('reference')}>
          {box('reference')}
        </FormField>
      </div>
      <CostEntryItemField entry={entry} />
    </FormSheet>
  );
}
