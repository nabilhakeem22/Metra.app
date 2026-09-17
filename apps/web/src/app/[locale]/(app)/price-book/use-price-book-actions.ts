'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { loadStarterCatalogue, setCostItemActive } from '@/lib/price-book/actions';
import { addSection } from '@/lib/sections/actions';
import type { PriceBookItem } from './types';

// Every server write the price book makes, and every toast it raises.

export interface PriceBookActionsApi {
  pending: boolean;
  addNewSection: (name: string, onAdded: () => void) => void;
  toggleActive: (item: PriceBookItem) => void;
  loadStarter: () => void;
}

export function usePriceBookActions(): PriceBookActionsApi {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const refuse = (code: ActionCode | undefined) =>
    toast({ title: resolveActionError(code, te), variant: 'destructive' });

  /** A new section is named in ONE language — the one the studio is working in.
   *  The other side stays null until somebody translates it. */
  function addNewSection(name: string, onAdded: () => void): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await addSection(
        locale.startsWith('ar') ? { nameAr: trimmed } : { nameEn: trimmed },
      );
      if (result.ok) {
        onAdded();
        toast({ title: t('toast.sectionAdded') });
        router.refresh();
      } else {
        refuse(result.error as ActionCode);
      }
    });
  }

  function toggleActive(item: PriceBookItem): void {
    startTransition(async () => {
      const result = await setCostItemActive(item.id, !item.active);
      if (result.ok) {
        toast({ title: t(item.active ? 'toast.deactivated' : 'toast.activated') });
      } else {
        refuse(result.error as ActionCode);
      }
    });
  }

  /** Loading the starter catalogue twice is not an error — it is a no-op, and the
   *  studio is told which of the two happened. */
  function loadStarter(): void {
    startTransition(async () => {
      const result = await loadStarterCatalogue();
      if (!result.ok) {
        refuse(result.error as ActionCode);
        return;
      }
      const inserted = result.data?.inserted ?? 0;
      toast({
        title:
          inserted > 0 ? t('toast.starterLoaded', { count: inserted }) : t('toast.starterExists'),
      });
    });
  }

  return { pending, addNewSection, toggleActive, loadStarter };
}
