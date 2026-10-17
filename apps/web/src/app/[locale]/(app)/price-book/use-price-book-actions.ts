'use client';

import { useTransition, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { deactivationCopy, useActiveToggle } from '@/hooks/use-active-toggle';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import { formatNumber } from '@/lib/format/number';
import type { MarketSeedSummary } from '@/lib/market-book/seed-core';
import { loadMarketPriceBook, setCostItemActive } from '@/lib/price-book/actions';
import type { PriceBookItem } from './types';

// The price book's row and page actions (activate, load the market book), and
// the toast each raises: neither has a field to say its refusal under. Adding a
// category lives with its box (./use-section-adder).

export interface PriceBookActionsApi {
  pending: boolean;
  /** The deactivate confirm; rendered once by the page. */
  confirmDialog: ReactNode;
  toggleActive: (item: PriceBookItem) => void;
  loadMarketBook: () => void;
}

export function usePriceBookActions(): PriceBookActionsApi {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  const refuse = (result: Pick<ActionResult, 'error' | 'params' | 'reference'>) =>
    toast({ title: describeFailure(result, te), variant: 'destructive' });
  const unreachable = (rejection: unknown) =>
    toast({ title: describeRejection(rejection, te), variant: 'destructive' });

  const activeToggle = useActiveToggle({
    setActive: setCostItemActive,
    copy: deactivationCopy(t, tc),
    onError: refuse,
  });

  /** Deactivating is confirmed and undoable; activating runs at once. */
  function toggleActive(item: PriceBookItem): void {
    void activeToggle.toggle(item);
  }

  /** Loading the market book twice is not an error: it adds nothing, and the
   *  studio is told which happened (loaded, nothing new, the book still being
   *  prepared, nothing published yet). */
  function loadMarketBook(): void {
    startTransition(async () => {
      let result;
      try {
        result = await loadMarketPriceBook();
      } catch (rejection) {
        unreachable(rejection);
        return;
      }
      if (!result.ok) {
        refuse(result);
        return;
      }
      toast({ title: marketLoadMessage(result.data) });
    });
  }

  function marketLoadMessage(summary: MarketSeedSummary | undefined): string {
    if (!summary || summary.book === 'unpublished') return t('toast.marketNotPublished');
    if (summary.book === 'preparing') return t('toast.marketPreparing');
    if (summary.items === 0) return t('toast.marketUpToDate');
    return t('toast.marketLoaded', { count: summary.items, shown: formatNumber(summary.items, locale) });
  }

  return {
    pending: pending || activeToggle.pending,
    confirmDialog: activeToggle.dialog,
    toggleActive,
    loadMarketBook,
  };
}
