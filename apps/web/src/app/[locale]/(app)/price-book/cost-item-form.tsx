'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { FormSheet } from '@/components/ui/form-sheet';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { createCostItem, updateCostItem } from '@/lib/price-book/actions';
import { costItemFieldErrors } from '@/lib/price-book/field-rules';
import type { MarketPriceRef } from '@/lib/market-book/types';
import { COST_ITEM_FIELDS } from '@/lib/price-book/fields';
import {
  costItemFormOf,
  costItemPayload,
  emptyCostItemForm,
  type CostItemFormState,
} from './cost-item-form-state';
import { CostItemFormFields } from './cost-item-form-fields';
import { MarketLinkField } from './market-link-field';
import type { PriceBookItem, SectionOption } from './types';

export interface CostItemFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: PriceBookItem | null;
  sections: SectionOption[];
  /** Null while no market bulletin is published (no link to offer); else the edited item's market reference. */
  market: { ref: MarketPriceRef | undefined } | null;
}

/**
 * Add or edit one price-book item. Save checks the typed values first and says
 * what is wrong under each field; what only the server knows (a code another
 * item took, a category deleted meanwhile) comes back the same way. An edit
 * also offers the market link, which saves on its own.
 */
export function CostItemForm({ open, onOpenChange, item, sections, market }: CostItemFormProps) {
  const t = useTranslations('priceBook');
  const th = useTranslations('hints.costItem');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [form, setForm] = useState<CostItemFormState>(() => emptyCostItemForm(sections));
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: COST_ITEM_FIELDS, translate: te });
  const { clear } = errors;

  // The form is filled when it opens on an item, not on every refresh: a market
  // link saved from this sheet refreshes the page, and what is typed must stay.
  const opened = useRef({ item, sections });
  useEffect(() => {
    opened.current = { item, sections };
  });
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!open) return;
    clear();
    const { item: openedItem, sections: openedSections } = opened.current;
    setForm(openedItem ? costItemFormOf(openedItem) : emptyCostItemForm(openedSections));
  }, [open, itemId, clear]);

  const set = (key: keyof CostItemFormState) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  function submit() {
    const payload = costItemPayload(form);
    // An edit checks against the item as stored: an unchanged code or name is never refused.
    if (errors.applyLocal(costItemFieldErrors(payload, item ?? undefined))) return;
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
      {item && market && <MarketLinkField costItemId={item.id} linked={item.marketItemId !== null} reference={market.ref} />}
    </FormSheet>
  );
}
