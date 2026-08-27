'use client';

import type { useTranslations } from 'next-intl';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import type { CostItemFormState } from './cost-item-form';
import type { SectionOption } from './types';

// The cost-item field groups (code · names · category/unit · cost/price · tax/eta).
// All form state and mutations live in the parent (CostItemForm); this child is
// presentational, driven by `form` and the curried `set` updater.
export function CostItemFormFields({
  t,
  th,
  locale,
  form,
  set,
  sections,
}: {
  t: ReturnType<typeof useTranslations<'priceBook'>>;
  th: ReturnType<typeof useTranslations<'hints.costItem'>>;
  locale: string;
  form: CostItemFormState;
  set: (k: keyof CostItemFormState) => (v: string) => void;
  sections: SectionOption[];
}) {
  return (
    <>
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
          <Select value={form.sectionId} onValueChange={(v) => set('sectionId')(v)}>
            <SelectTrigger id="ci-category" aria-describedby="ci-category-hint">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {pickLocale({ nameAr: s.nameAr, nameEn: s.nameEn }, 'name', locale).value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ci-unit" className="flex items-center">
            {t('form.unit')}
            <FieldHint id="ci-unit-hint" hint={th('unit')} />
          </Label>
          <Select value={form.unit} onValueChange={(v) => set('unit')(v)}>
            <SelectTrigger id="ci-unit" aria-describedby="ci-unit-hint">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIT_TOKENS.map((u) => (
                <SelectItem key={u} value={u}>
                  {t(`units.${u}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
    </>
  );
}
