'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormSheet } from '@/components/ui/form-sheet';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { createCostItem, updateCostItem } from '@/lib/price-book/actions';
import { costItemFieldErrors } from '@/lib/price-book/field-rules';
import { COST_ITEM_FIELDS } from '@/lib/price-book/fields';
import {
  costItemFormOf,
  costItemPayload,
  emptyCostItemForm,
  type CostItemFormState,
} from './cost-item-form-state';
import { CostItemFormFields } from './cost-item-form-fields';
import type { PriceBookItem, SectionOption } from './types';

export interface CostItemFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: PriceBookItem | null;
  sections: SectionOption[];
}

/**
 * Add or edit one price-book item. Save checks the typed values first and says
 * what is wrong under each field; what only the server knows (a code another
 * item took, a category deleted meanwhile) comes back the same way.
 */
export function CostItemForm({ open, onOpenChange, item, sections }: CostItemFormProps) {
  const t = useTranslations('priceBook');
  const th = useTranslations('hints.costItem');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [form, setForm] = useState<CostItemFormState>(() => emptyCostItemForm(sections));
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: COST_ITEM_FIELDS, translate: te });
  const { clear } = errors;

  useEffect(() => {
    if (!open) return;
    clear();
    setForm(item ? costItemFormOf(item) : emptyCostItemForm(sections));
  }, [open, item, sections, clear]);

  const set = (key: keyof CostItemFormState) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  function submit() {
    const payload = costItemPayload(form);
    if (errors.applyLocal(costItemFieldErrors(payload))) return;
    startTransition(async () => {
      try {
        const result = item
          ? await updateCostItem({ id: item.id, ...payload })
          : await createCostItem(payload);
        if (errors.applyResult(result)) return;
        toast({ title: t(item ? 'toast.updated' : 'toast.created') });
        onOpenChange(false);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(item ? 'form.editTitle' : 'form.newTitle')}
      onSubmit={submit}
      submitLabel={t('form.save')}
      cancelLabel={t('form.cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <CostItemFormFields
        t={t}
        th={th}
        locale={locale}
        form={form}
        set={set}
        sections={sections}
        bind={errors.bind}
      />
    </FormSheet>
  );
}
