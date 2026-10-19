'use client';

import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { MarketItemRow } from '@/lib/market-book/types';
import { itemName, itemSpec, itemUnit } from './market-item-text';
import { MarketItemMonths } from './market-item-months';
import { useMarketItemDetail } from './use-market-item-detail';

export interface MarketItemDrawerProps {
  /** The item shown; null closes the drawer. */
  item: MarketItemRow | null;
  onClose: () => void;
  /** The attribution block, rendered by the server page: every drawer carries it. */
  attribution: ReactNode;
}

/** One market item's provenance: every effective month with its bulletin and page, the price basis, the source. */
export function MarketItemDrawer({ item, onClose, attribution }: MarketItemDrawerProps) {
  const t = useTranslations('marketBook');
  const tc = useTranslations('common');
  const locale = useLocale();
  const state = useMarketItemDetail(item?.id ?? null);

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="end" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
        {item && (
          <div className="space-y-4 p-4">
            <div className="flex items-start gap-2">
              <div className="space-y-1">
                <SheetTitle className="text-title">{itemName(item, locale)}</SheetTitle>
                <SheetDescription>
                  {[itemSpec(item, locale), t('perUnit', { unit: itemUnit(item, locale, (unit) => t(`units.${unit}`)) })].filter(Boolean).join(' · ')}
                </SheetDescription>
              </div>
              <SheetClose asChild>
                <IconButton type="button" aria-label={tc('close')} className="ms-auto">
                  <X className="size-4" aria-hidden />
                </IconButton>
              </SheetClose>
            </div>

            {item.basisNoteAr && (
              <div className="space-y-1">
                <h3 className="text-caption font-medium text-muted-foreground">{t('drawer.basis')}</h3>
                <p lang="ar" dir="rtl" className="text-body">{item.basisNoteAr}</p>
              </div>
            )}

            <section className="space-y-2" aria-busy={state.status === 'loading'}>
              <h3 className="text-caption font-medium text-muted-foreground">{t('drawer.months')}</h3>
              {state.status === 'ready' && <MarketItemMonths points={state.detail.allPoints} />}
              {state.status === 'loading' && <p className="text-body text-muted-foreground">{t('drawer.loading')}</p>}
              {state.status === 'failed' && <p role="alert" className="text-body text-destructive">{state.message}</p>}
            </section>

            {attribution}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
