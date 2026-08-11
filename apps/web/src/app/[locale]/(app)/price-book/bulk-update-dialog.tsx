'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
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
import { bulkUpdatePrices } from '@/lib/price-book/actions';
import { CATEGORY_TOKENS } from '@/lib/price-book/import';
import type { PriceBookItem } from './types';

export interface BulkUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Target = 'cost' | 'price' | 'both';

export function BulkUpdateDialog({ open, onOpenChange }: BulkUpdateDialogProps) {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const [category, setCategory] = useState<string>(CATEGORY_TOKENS[0]);
  const [pct, setPct] = useState('0');
  const [target, setTarget] = useState<Target>('both');
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [pending, startTransition] = useTransition();

  function apply() {
    startTransition(async () => {
      const res = await bulkUpdatePrices({
        category: category as PriceBookItem['category'],
        pct,
        target,
        effectiveDate,
      });
      if (res.ok) {
        toast({
          title: t('bulk.applied', { count: res.data?.itemCount ?? 0 }),
        });
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
      <SheetContent className="w-full sm:max-w-md">
        <SheetTitle>{t('bulk.title')}</SheetTitle>
        <SheetDescription>{t('bulk.description')}</SheetDescription>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bulk-category">{t('bulk.category')}</Label>
            <select
              id="bulk-category"
              className={selectClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORY_TOKENS.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-pct">{t('bulk.percentage')}</Label>
            <Input
              id="bulk-pct"
              dir="ltr"
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">{t('bulk.target')}</span>
            <div className="flex gap-4">
              {(['cost', 'price', 'both'] as Target[]).map((tg) => (
                <label key={tg} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="bulk-target"
                    value={tg}
                    checked={target === tg}
                    onChange={() => setTarget(tg)}
                  />
                  {t(
                    tg === 'cost'
                      ? 'bulk.targetCost'
                      : tg === 'price'
                        ? 'bulk.targetPrice'
                        : 'bulk.targetBoth',
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-date">{t('bulk.effectiveDate')}</Label>
            <Input
              id="bulk-date"
              type="date"
              dir="ltr"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t('bulk.cancel')}
            </Button>
            <Button type="button" onClick={apply} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('bulk.apply')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
