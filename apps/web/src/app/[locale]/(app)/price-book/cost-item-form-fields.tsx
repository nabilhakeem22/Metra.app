'use client';

import type { useTranslations } from 'next-intl';
import { fieldErrorId } from '@/components/ui/field-error-text';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { CostItemField } from '@/lib/price-book/fields';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import type { CostItemFormState } from './cost-item-form-state';
import type { SectionOption } from './types';

/** The control each refusal sits under; `name` (the pair) under the English name, each half under its own. */
export const COST_ITEM_CONTROL_ID: Record<CostItemField, string> = {
  code: 'ci-code',
  name: 'ci-nameEn',
  nameEn: 'ci-nameEn',
  nameAr: 'ci-nameAr',
  sectionId: 'ci-category',
  unit: 'ci-unit',
  defaultUnitCost: 'ci-cost',
  defaultUnitPrice: 'ci-price',
  taxCode: 'ci-tax',
  etaItemCode: 'ci-eta',
  etaCodeType: 'ci-etatype',
};

type Bind = (field: CostItemField) => { error: string | undefined; onEdit: () => void };

// The cost-item field groups (code · names · category/unit · cost/price · tax/eta).
// All form state and mutations live in the parent (CostItemForm); this child is
// presentational, driven by `form`, the curried `set` updater and `bind`.
export function CostItemFormFields({
  t,
  th,
  locale,
  form,
  set,
  sections,
  bind,
}: {
  t: ReturnType<typeof useTranslations<'priceBook'>>;
  th: ReturnType<typeof useTranslations<'hints.costItem'>>;
  locale: string;
  form: CostItemFormState;
  set: (key: keyof CostItemFormState) => (value: string) => void;
  sections: SectionOption[];
  bind: Bind;
}) {
  const id = COST_ITEM_CONTROL_ID;
  const text = (key: keyof CostItemFormState) => (
    <Input dir="ltr" value={form[key]} onChange={(event) => set(key)(event.target.value)} />
  );
  const money = (key: 'defaultUnitCost' | 'defaultUnitPrice') => (
    <Input
      dir="ltr"
      inputMode="decimal"
      value={form[key]}
      onChange={(event) => set(key)(event.target.value)}
    />
  );
  const name = bind('name');
  const nameEn = bind('nameEn');
  const nameAr = bind('nameAr');
  const editing = (half: { onEdit: () => void }) => () => {
    name.onEdit();
    half.onEdit();
  };

  return (
    <>
      <FormField id={id.code} label={t('form.code')} required hint={th('code')} {...bind('code')}>
        {text('code')}
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id={id.nameEn} label={t('form.nameEn')} hint={th('name')} error={name.error ?? nameEn.error} onEdit={editing(nameEn)}>
          {text('nameEn')}
        </FormField>
        {/* The pair shares ONE refusal (D5): it is said under the English name,
            and the Arabic name points at the same sentence. A refusal of the
            Arabic name alone (too long, hidden characters) is said under it. */}
        <FormField id={id.nameAr} label={t('form.nameAr')} hint={th('name')} error={nameAr.error} onEdit={editing(nameAr)}>
          <Input
            dir="rtl"
            value={form.nameAr}
            aria-invalid={name.error ? true : undefined}
            aria-describedby={name.error ? fieldErrorId(id.name) : undefined}
            onChange={(event) => set('nameAr')(event.target.value)}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          id={id.sectionId}
          label={t('form.category')}
          hint={th('category')}
          {...bind('sectionId')}
        >
          <SelectControl
            value={form.sectionId}
            onValueChange={set('sectionId')}
            options={sections.map((section) => ({
              value: section.id,
              label: pickLocale({ nameAr: section.nameAr, nameEn: section.nameEn }, 'name', locale)
                .value,
            }))}
          />
        </FormField>
        <FormField id={id.unit} label={t('form.unit')} hint={th('unit')} {...bind('unit')}>
          <SelectControl
            value={form.unit}
            onValueChange={set('unit')}
            options={UNIT_TOKENS.map((unit) => ({ value: unit, label: t(`units.${unit}`) }))}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          id={id.defaultUnitCost}
          label={t('form.cost')}
          hint={th('defaultUnitCost')}
          {...bind('defaultUnitCost')}
        >
          {money('defaultUnitCost')}
        </FormField>
        <FormField
          id={id.defaultUnitPrice}
          label={t('form.price')}
          hint={th('defaultUnitPrice')}
          {...bind('defaultUnitPrice')}
        >
          {money('defaultUnitPrice')}
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField id={id.taxCode} label={t('form.taxCode')} {...bind('taxCode')}>
          {text('taxCode')}
        </FormField>
        <FormField id={id.etaItemCode} label={t('form.etaItemCode')} {...bind('etaItemCode')}>
          {text('etaItemCode')}
        </FormField>
        <FormField id={id.etaCodeType} label={t('form.etaCodeType')} {...bind('etaCodeType')}>
          {text('etaCodeType')}
        </FormField>
      </div>
    </>
  );
}
