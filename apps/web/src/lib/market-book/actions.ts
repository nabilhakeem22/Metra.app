'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { studioReadRefusal } from '@/lib/cf/studio-read-rate-limit';
import { addMarketItemToPriceBookCore, linkCostItemToMarketCore, type AddMarketItemInput } from './core';
import { readMarketItemCore } from './item-core';
import { searchMarketLinksCore } from './link-search';
import type { MarketItemDetail, MarketLinkSearch } from './types';

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

/** The price book's market link: follow a market item (or none, with null). Never changes the item's cost or price. */
export async function linkCostItemToMarket(input: { costItemId: string; marketItemId: string | null }): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await linkCostItemToMarketCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

/** The link combobox's search, on the member's market link search budget. */
export async function searchMarketLinks(request: { costItemId: string; query: string }): Promise<ActionResult & { data?: MarketLinkSearch }> {
  const ctx = await requireOrg();
  return (await studioReadRefusal(ctx, 'market_link_search')) ?? searchMarketLinksCore(ctx, request);
}
