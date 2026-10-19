'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { addMarketItemToPriceBookCore, type AddMarketItemInput } from './core';
import { readMarketItemCore } from './item-core';
import type { MarketItemDetail } from './types';

/** "Add to my price book" on /market-book (owners and admins). */
export async function addMarketItemToPriceBook(input: AddMarketItemInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await addMarketItemToPriceBookCore(ctx, input);
  if (!res.ok) return res;
  refreshApp();
  return { ok: true };
}

/** The drawer of one market item: every effective month with its bulletin and page. */
export async function loadMarketItem(marketItemId: string): Promise<ActionResult & { data?: MarketItemDetail }> {
  const ctx = await requireOrg();
  return readMarketItemCore(ctx, marketItemId);
}
