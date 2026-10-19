import 'server-only';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { shiftMonth } from './change';
import {
  decodeBulletin,
  decodeCategory,
  decodeItem,
  decodePoint,
  type BulletinTuple,
  type CategoryTuple,
  type ItemTuple,
} from './decode';
import { marketItemSql } from './item-sql';
import type { MarketBookView } from './page-params';
import { marketBookPageSql } from './page-sql';
import type { MarketBookPage, MarketItemDetail } from './types';

// The studio's reads of the market price book: platform data every member org
// may read (rls/policies/60-market.sql), inside the studio's own org context so
// the "in my price book" link is this studio's alone. Read-only, and never a
// throw for "no data": no bulletin is a page with `bulletin: null` and no rows.

type PageTuple = [BulletinTuple | null, CategoryTuple[], string | null, number, number, ItemTuple[]];

/** Everything /market-book shows for `view`, in the page's language order. */
export async function readMarketBookPage(ctx: OrgContext, view: MarketBookView, locale: string): Promise<MarketBookPage> {
  const rows = (await withOrgContext(ctx, (tx) => tx.execute(marketBookPageSql(view, locale)))) as unknown as Array<{ page: string }>;
  const [bulletin, categories, categoryKey, matched, page, items] = JSON.parse(rows[0].page) as PageTuple;
  return {
    bulletin: decodeBulletin(bulletin),
    categories: categories.map(decodeCategory),
    categoryKey,
    matched,
    page,
    items: items.map((tuple) => decodeItem(tuple, tuple[13].map(decodePoint))),
  };
}

/** One item for its drawer, or null when the studio cannot see it (no such id, or no published price). */
export async function readMarketItem(ctx: OrgContext, itemId: string): Promise<MarketItemDetail | null> {
  const rows = (await withOrgContext(ctx, (tx) => tx.execute(marketItemSql(itemId)))) as unknown as Array<{ item: string }>;
  const [latestMonth, tuple] = JSON.parse(rows[0].item) as [string | null, ItemTuple | null];
  if (tuple === null || latestMonth === null) return null;
  const allPoints = tuple[13].map(decodePoint);
  const firstShown = shiftMonth(latestMonth, -12);
  return { ...decodeItem(tuple, allPoints.filter((point) => point.month >= firstShown)), allPoints };
}
