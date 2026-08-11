'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createCostItem, updateCostItem } from '@/lib/price-book/actions';
import { CATEGORY_TOKENS, UNIT_TOKENS } from '@/lib/price-book/import';
import type { PriceBookItem } from './types';

export interface CostItemFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: PriceBookItem | null;
}

interface FormState {
  code: string;
  nameEn: string;
  nameAr: string;
  category: string;
  unit: string;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  taxCode: string;
  etaItemCode: string;
  etaCodeType: string;
}

function emptyState(): FormState {
  return {
    code: '',
    nameEn: '',
    nameAr: '',
    category: CATEGORY_TOKENS[0],
    unit: UNIT_TOKENS[0],
    defaultUnitCost: '0',
    defaultUnitPrice: '0',
    taxCode: '',
    etaItemCode: '',
    etaCodeType: '',
  };
}

export function CostItemForm({ open, onOpenChange, item }: CostItemFormProps) {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const [form, setForm] = useState<FormState>(emptyState());
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setForm(
      item
        ? {
            code: item.code,
            nameEn: item.nameEn ?? '',
            nameAr: item.nameAr ?? '',
            category: item.category,
            unit: item.unit,
            defaultUnitCost: item.defaultUnitCost,
            defaultUnitPrice: item.defaultUnitPrice,
            taxCode: item.taxCode ?? '',
            etaItemCode: item.etaItemCode ?? '',
            etaCodeType: item.etaCodeType ?? '',
          }
        : emptyState(),
    );
  }, [open, item]);

  const set = (k: keyof FormState) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    startTransition(async () => {
      const payload = {
        code: form.code,
        nameEn: form.nameEn || null,
        nameAr: form.nameAr || null,
        category: form.category as PriceBookItem['category'],
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

  const selectClass =
    'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle>{t(item ? 'form.editTitle' : 'form.newTitle')}</SheetTitle>
        <SheetDescription className="sr-only">
          {t(item ? 'form.editTitle' : 'form.newTitle')}
        </SheetDescription>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ci-code">{t('form.code')}</Label>
            <Input
              id="ci-code"
              dir="ltr"
              value={form.code}
              onChange={(e) => set('code')(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ci-nameEn">{t('form.nameEn')}</Label>
              <Input
                id="ci-nameEn"
                dir="ltr"
                value={form.nameEn}
                onChange={(e) => set('nameEn')(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-nameAr">{t('form.nameAr')}</Label>
              <Input
                id="ci-nameAr"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => set('nameAr')(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ci-category">{t('form.category')}</Label>
              <select
                id="ci-category"
                className={selectClass}
                value={form.category}
                onChange={(e) => set('category')(e.target.value)}
              >
                {CATEGORY_TOKENS.map((c) => (
                  <option key={c} value={c}>
                    {t(`categories.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-unit">{t('form.unit')}</Label>
              <select
                id="ci-unit"
                className={selectClass}
                value={form.unit}
                onChange={(e) => set('unit')(e.target.value)}
              >
                {UNIT_TOKENS.map((u) => (
                  <option key={u} value={u}>
                    {t(`units.${u}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ci-cost">{t('form.cost')}</Label>
              <Input
                id="ci-cost"
                dir="ltr"
                inputMode="decimal"
                value={form.defaultUnitCost}
                onChange={(e) => set('defaultUnitCost')(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-price">{t('form.price')}</Label>
              <Input
                id="ci-price"
                dir="ltr"
                inputMode="decimal"
                value={form.defaultUnitPrice}
                onChange={(e) => set('defaultUnitPrice')(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="ci-tax">{t('form.taxCode')}</Label>
              <Input
                id="ci-tax"
                dir="ltr"
                value={form.taxCode}
                onChange={(e) => set('taxCode')(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-eta">{t('form.etaItemCode')}</Label>
              <Input
                id="ci-eta"
                dir="ltr"
                value={form.etaItemCode}
                onChange={(e) => set('etaItemCode')(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-etatype">{t('form.etaCodeType')}</Label>
              <Input
                id="ci-etatype"
                dir="ltr"
                value={form.etaCodeType}
                onChange={(e) => set('etaCodeType')(e.target.value)}
              />
            </div>
          </div>

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
