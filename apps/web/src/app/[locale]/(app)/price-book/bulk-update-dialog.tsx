'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FieldHint } from '@/components/ui/field-hint';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { bulkUpdatePrices } from '@/lib/price-book/actions';
import { bulkPercentError } from '@/lib/price-book/percent';
import type { SectionOption } from './types';

export interface BulkUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionOption[];
}

type Target = 'cost' | 'price' | 'both';

const BULK_FIELDS = ['sectionId', 'pct'] as const;
const TARGETS: { value: Target; label: string }[] = [
  { value: 'cost', label: 'bulk.targetCost' },
  { value: 'price', label: 'bulk.targetPrice' },
  { value: 'both', label: 'bulk.targetBoth' },
];

/**
 * Change one category's costs and/or prices by a percentage, now. A
 * percentage that is missing, not a number or outside -100 to 1000 is said
 * under the box before anything is sent; a category deleted meanwhile is said
 * under the category.
 */
export function BulkUpdateDialog({ open, onOpenChange, sections }: BulkUpdateDialogProps) {
  const t = useTranslations('priceBook');
  const th = useTranslations('hints.priceBook');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [sectionId, setSectionId] = useState<string>(sections[0]?.id ?? '');
  const [pct, setPct] = useState('0');
  const [target, setTarget] = useState<Target>('both');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: BULK_FIELDS, translate: te });
  const { clear } = errors;

  useEffect(() => {
    if (open) clear();
  }, [open, clear]);

  function apply() {
    const pctError = bulkPercentError(pct);
    if (errors.applyLocal(pctError ? { pct: pctError } : {})) return;
    startTransition(async () => {
      try {
        const res = await bulkUpdatePrices({ sectionId, pct, target, effectiveDate });
        if (errors.applyResult(res)) return;
        toast({ title: t('bulk.applied', { count: res.data?.itemCount ?? 0 }) });
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
      title={t('bulk.title')}
      description={t('bulk.description')}
      onSubmit={apply}
      submitLabel={t('bulk.apply')}
      cancelLabel={t('bulk.cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <FormField id="bulk-category" label={t('bulk.category')} hint={th('category')} {...errors.bind('sectionId')}>
        <SelectControl
          value={sectionId}
          onValueChange={setSectionId}
          options={sections.map((s) => ({
            value: s.id,
            label: pickLocale({ nameAr: s.nameAr, nameEn: s.nameEn }, 'name', locale).value,
          }))}
        />
      </FormField>

      <FormField id="bulk-pct" label={t('bulk.percentage')} hint={th('pctChange')} {...errors.bind('pct')}>
        <Input dir="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
      </FormField>

      <div className="space-y-2">
        <span className="inline-flex items-center text-body font-medium">
          {t('bulk.target')}
          <FieldHint hint={th('target')} />
        </span>
        <div className="flex gap-4">
          {TARGETS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-body">
              <input
                type="radio"
                name="bulk-target"
                value={option.value}
                checked={target === option.value}
                onChange={() => setTarget(option.value)}
              />
              {t(option.label)}
            </label>
          ))}
        </div>
      </div>

      <FormField id="bulk-date" label={t('bulk.effectiveDate')}>
        <Input
          type="date"
          dir="ltr"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
      </FormField>
    </FormSheet>
  );
}
