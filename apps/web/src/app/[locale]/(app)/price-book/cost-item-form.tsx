'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { useLocale } from 'next-intl';
import { createCostItem, updateCostItem } from '@/lib/price-book/actions';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import { CostItemFormFields } from './cost-item-form-fields';
import type { PriceBookItem, SectionOption } from './types';

export interface CostItemFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: PriceBookItem | null;
  sections: SectionOption[];
}

export interface CostItemFormState {
  code: string;
  nameEn: string;
  nameAr: string;
  sectionId: string;
  unit: string;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  taxCode: string;
  etaItemCode: string;
  etaCodeType: string;
}

function emptyState(sections: SectionOption[]): CostItemFormState {
  return {
    code: '',
    nameEn: '',
    nameAr: '',
    sectionId: sections[0]?.id ?? '',
    unit: UNIT_TOKENS[0],
    defaultUnitCost: '0',
    defaultUnitPrice: '0',
    taxCode: '',
    etaItemCode: '',
    etaCodeType: '',
  };
}

export function CostItemForm({
  open,
  onOpenChange,
  item,
  sections,
}: CostItemFormProps) {
  const t = useTranslations('priceBook');
  const th = useTranslations('hints.costItem');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [form, setForm] = useState<CostItemFormState>(emptyState(sections));
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setForm(
      item
        ? {
            code: item.code,
            nameEn: item.nameEn ?? '',
            nameAr: item.nameAr ?? '',
            sectionId: item.sectionId,
            unit: item.unit,
            defaultUnitCost: item.defaultUnitCost,
            defaultUnitPrice: item.defaultUnitPrice,
            taxCode: item.taxCode ?? '',
            etaItemCode: item.etaItemCode ?? '',
            etaCodeType: item.etaCodeType ?? '',
          }
        : emptyState(sections),
    );
  }, [open, item, sections]);

  const set = (k: keyof CostItemFormState) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    startTransition(async () => {
      const payload = {
        code: form.code,
        nameEn: form.nameEn || null,
        nameAr: form.nameAr || null,
        sectionId: form.sectionId,
        unit: form.unit as PriceBookItem['unit'],
        defaultUnitCost: form.defaultUnitCost,
        defaultUnitPrice: form.defaultUnitPrice,
        taxCode: form.taxCode || null,
        etaItemCode: form.etaItemCode || null,
        etaCodeType: form.etaCodeType || null,
      };
      const res = item
        ? await updateCostItem({ id: item.id, ...payload })
        : await createCostItem(payload);
      if (res.ok) {
        toast({ title: t(item ? 'toast.updated' : 'toast.created') });
        onOpenChange(false);
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle>{t(item ? 'form.editTitle' : 'form.newTitle')}</SheetTitle>
        <SheetDescription className="sr-only">
          {t(item ? 'form.editTitle' : 'form.newTitle')}
        </SheetDescription>

        <div className="mt-4 space-y-4">
          <CostItemFormFields
            t={t}
            th={th}
            locale={locale}
            form={form}
            set={set}
            sections={sections}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t('form.cancel')}
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('form.save')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
