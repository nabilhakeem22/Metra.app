'use client';

import { useTransition, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { deactivationCopy, useActiveToggle } from '@/hooks/use-active-toggle';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import { loadStarterCatalogue, setCostItemActive } from '@/lib/price-book/actions';
import type { PriceBookItem } from './types';

// The price book's row and page actions (activate, load the starter list), and
// the toast each raises: neither has a field to say its refusal under. Adding a
// category lives with its box (./use-section-adder).

export interface PriceBookActionsApi {
  pending: boolean;
  /** The deactivate confirm; rendered once by the page. */
  confirmDialog: ReactNode;
  toggleActive: (item: PriceBookItem) => void;
  loadStarter: () => void;
}

export function usePriceBookActions(): PriceBookActionsApi {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
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

  /** Loading the starter catalogue twice is not an error — it is a no-op, and the
   *  studio is told which of the two happened. */
  function loadStarter(): void {
    startTransition(async () => {
      let result;
      try {
        result = await loadStarterCatalogue();
      } catch (rejection) {
        unreachable(rejection);
        return;
      }
      if (!result.ok) {
        refuse(result);
        return;
      }
      const inserted = result.data?.inserted ?? 0;
      toast({
        title:
          inserted > 0 ? t('toast.starterLoaded', { count: inserted }) : t('toast.starterExists'),
      });
    });
  }

  return {
    pending: pending || activeToggle.pending,
    confirmDialog: activeToggle.dialog,
    toggleActive,
    loadStarter,
  };
}
