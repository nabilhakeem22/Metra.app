'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { loadMarketItem } from '@/lib/market-book/actions';
import type { MarketItemDetail } from '@/lib/market-book/types';

export type MarketItemDetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: MarketItemDetail }
  | { status: 'failed'; message: string };

/**
 * The drawer's months, asked for when an item opens (its own request), and
 * forgotten when another opens: an answer for an item no longer shown is
 * dropped, never painted under the wrong name.
 */
export function useMarketItemDetail(itemId: string | null): MarketItemDetailState {
  const te = useTranslations('errors');
  const [state, setState] = useState<{ itemId: string; value: MarketItemDetailState } | null>(null);

  useEffect(() => {
    if (itemId === null) return;
    let current = true;
    const settle = (value: MarketItemDetailState) => {
      if (current) setState({ itemId, value });
    };
    loadMarketItem(itemId).then(
      (result) => settle(result.ok && result.data ? { status: 'ready', detail: result.data } : { status: 'failed', message: describeFailure(result, te) }),
      (rejection: unknown) => settle({ status: 'failed', message: describeRejection(rejection, te) }),
    );
    return () => {
      current = false;
    };
  }, [itemId, te]);

  return state !== null && state.itemId === itemId ? state.value : { status: 'loading' };
}
