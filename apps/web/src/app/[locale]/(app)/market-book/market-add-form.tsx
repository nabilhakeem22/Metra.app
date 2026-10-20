'use client';

import { sectionKey } from '@metra/db/market-seed';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { FormSheet } from '@/components/ui/form-sheet';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { addMarketItemToPriceBook } from '@/lib/market-book/actions';
import { ADD_MARKET_ITEM_FIELDS, readAddMarketItemInput, suggestedCode, type AddMarketItemField } from '@/lib/market-book/add-input';
import { studioUnitFor } from '@/lib/market-book/units';
import { MarketAddCost } from './market-add-cost';
import type { MarketRowView } from './market-row-view';

export interface MarketSectionOption {
  id: string;
  key: string | null;
  nameAr: string | null;
  nameEn: string | null;
}

/** The control each refusal sits under. */
export const MARKET_ADD_CONTROL_ID: Record<AddMarketItemField, string> = {
  code: 'ma-code',
  nameAr: 'ma-nameAr',
  nameEn: 'ma-nameEn',
  sectionId: 'ma-section',
  defaultUnitPrice: 'ma-price',
};

interface AddFormState {
  code: string;
  nameAr: string;
  nameEn: string;
  sectionId: string;
  defaultUnitPrice: string;
}

/**
 * The offer: the seed's code and names (blank only before the seed book is
 * built; the server then answers that the book is being prepared), and the
 * section the seed files this sub-category under when the studio has it.
 */
function offerFor(item: MarketRowView, sections: readonly MarketSectionOption[]): AddFormState {
  const seeded = sections.find((section) => section.key === sectionKey(item.categoryKey));
  const names = item.seededNames ?? { nameAr: '', nameEn: '' };
  return { code: suggestedCode(item), ...names, sectionId: (seeded ?? sections[0])?.id ?? '', defaultUnitPrice: '' };
}

export interface MarketAddFormProps {
  /** The item being added; null closes the form. */
  item: MarketRowView | null;
  sections: readonly MarketSectionOption[];
  onClose: () => void;
  /** The attribution block, rendered by the server page: every market surface carries it. */
  attribution: ReactNode;
}

/**
 * "Add to my price book": a new cost item linked to the market item. The unit,
 * the cost and the default selling price are the market item's (shown, not
 * typed); every refusal the studio can fix is said under its field.
 */
export function MarketAddForm({ item, sections, onClose, attribution }: MarketAddFormProps) {
  const t = useTranslations('marketBook');
  const tp = useTranslations('priceBook');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [form, setForm] = useState<AddFormState | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: ADD_MARKET_ITEM_FIELDS, translate: te });
  const { clear } = errors;

  useEffect(() => {
    clear();
    setForm(item ? offerFor(item, sections) : null);
  }, [item, sections, clear]);

  const set = (key: keyof AddFormState) => (value: string) => setForm((current) => (current ? { ...current, [key]: value } : current));
  const unit = item ? studioUnitFor(item.unit) : null;

  function submit() {
    if (!item || !form) return;
    const input = { marketItemId: item.id, ...form };
    const read = readAddMarketItemInput(input);
    if (errors.applyLocal(read.ok ? {} : read.errors)) return;
    startTransition(async () => {
      try {
        if (errors.applyResult(await addMarketItemToPriceBook(input))) return;
        toast({ title: t('addForm.added') });
        onClose();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <FormSheet
      open={item !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('add')}
      description={t('addForm.description')}
      onSubmit={submit}
      submitLabel={t('addForm.save')}
      cancelLabel={tp('form.cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      {item && form && (
        <>
          <FormField id={MARKET_ADD_CONTROL_ID.code} label={tp('form.code')} required {...errors.bind('code')}>
            <Input dir="ltr" value={form.code} onChange={(event) => set('code')(event.target.value)} />
          </FormField>
          <FormField id={MARKET_ADD_CONTROL_ID.nameAr} label={tp('form.nameAr')} {...errors.bind('nameAr')}>
            <Input dir="rtl" value={form.nameAr} onChange={(event) => set('nameAr')(event.target.value)} />
          </FormField>
          <FormField id={MARKET_ADD_CONTROL_ID.nameEn} label={tp('form.nameEn')} {...errors.bind('nameEn')}>
            <Input dir="ltr" value={form.nameEn} onChange={(event) => set('nameEn')(event.target.value)} />
          </FormField>
          <FormField id={MARKET_ADD_CONTROL_ID.sectionId} label={tp('form.category')} required {...errors.bind('sectionId')}>
            <SelectControl
              value={form.sectionId}
              onValueChange={set('sectionId')}
              options={sections.map((section) => ({ value: section.id, label: pickLocale({ nameAr: section.nameAr, nameEn: section.nameEn }, 'name', locale).value }))}
            />
          </FormField>
          {item.latestPriced && <MarketAddCost priced={item.latestPriced} isOld={item.latestPricedIsOld} unitLabel={unit ? tp(`units.${unit}`) : ''} />}
          <FormField id={MARKET_ADD_CONTROL_ID.defaultUnitPrice} label={tp('form.price')} hint={t('addForm.priceHint')} {...errors.bind('defaultUnitPrice')}>
            <Input dir="ltr" inputMode="decimal" value={form.defaultUnitPrice} onChange={(event) => set('defaultUnitPrice')(event.target.value)} />
          </FormField>
          {attribution}
        </>
      )}
    </FormSheet>
  );
}
