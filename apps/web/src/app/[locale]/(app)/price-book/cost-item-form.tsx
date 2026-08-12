'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldHint } from '@/components/ui/field-hint';
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
import { useLocale } from 'next-intl';
import { createCostItem, updateCostItem } from '@/lib/price-book/actions';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import type { PriceBookItem, SectionOption } from './types';

export interface CostItemFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: PriceBookItem | null;
  sections: SectionOption[];
}

interface FormState {
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

function emptyState(sections: SectionOption[]): FormState {
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
  const [form, setForm] = useState<FormState>(emptyState(sections));
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

  const set = (k: keyof FormState) => (v: string) =>
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
            <Label htmlFor="ci-code" className="flex items-center">
              {t('form.code')}
              <FieldHint id="ci-code-hint" hint={th('code')} />
            </Label>
            <Input
              id="ci-code"
              dir="ltr"
              aria-describedby="ci-code-hint"
              value={form.code}
              onChange={(e) => set('code')(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ci-nameEn" className="flex items-center">
                {t('form.nameEn')}
                <FieldHint id="ci-name-hint" hint={th('name')} />
              </Label>
              <Input
                id="ci-nameEn"
                dir="ltr"
                aria-describedby="ci-name-hint"
                value={form.nameEn}
                onChange={(e) => set('nameEn')(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-nameAr" className="flex items-center">
                {t('form.nameAr')}
                <FieldHint id="ci-namear-hint" hint={th('name')} />
              </Label>
              <Input
                id="ci-nameAr"
                dir="rtl"
                aria-describedby="ci-namear-hint"
                value={form.nameAr}
                onChange={(e) => set('nameAr')(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ci-category" className="flex items-center">
                {t('form.category')}
                <FieldHint id="ci-category-hint" hint={th('category')} />
              </Label>
              <select
                id="ci-category"
                className={selectClass}
                aria-describedby="ci-category-hint"
                value={form.sectionId}
                onChange={(e) => set('sectionId')(e.target.value)}
              >
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {pickLocale({ nameAr: s.nameAr, nameEn: s.nameEn }, 'name', locale).value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-unit" className="flex items-center">
                {t('form.unit')}
                <FieldHint id="ci-unit-hint" hint={th('unit')} />
              </Label>
              <select
                id="ci-unit"
                className={selectClass}
                aria-describedby="ci-unit-hint"
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
              <Label htmlFor="ci-cost" className="flex items-center">
                {t('form.cost')}
                <FieldHint id="ci-cost-hint" hint={th('defaultUnitCost')} />
              </Label>
              <Input
                id="ci-cost"
                dir="ltr"
                inputMode="decimal"
                aria-describedby="ci-cost-hint"
                value={form.defaultUnitCost}
                onChange={(e) => set('defaultUnitCost')(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-price" className="flex items-center">
                {t('form.price')}
                <FieldHint id="ci-price-hint" hint={th('defaultUnitPrice')} />
              </Label>
              <Input
                id="ci-price"
                dir="ltr"
                inputMode="decimal"
                aria-describedby="ci-price-hint"
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
