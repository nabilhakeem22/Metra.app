import 'server-only';
// The price book's market link combobox (market plan task 18): the market
// items a cost item may follow, found by every typed word. Read from the seed
// book (market_seed_book), whose `unit` is the market unit's studio twin
// (./units.ts), so "the units compare" is one equality in SQL and only items
// a link would accept are offered; the seed book is also free of the per-row
// market_items policy. Gated and shape-checked before any SQL runs; the
// 'use server' wrapper in ./actions adds the session and the search budget.
import { costItems, marketSeedBook } from '@metra/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { cleanSearchQuery } from '@/lib/search/query-input';
import { everyWordSql } from '@/lib/search/words-sql';
import { isUuid } from '@/lib/uuid';
import type { MarketLinkSearch } from './types';

/** The most items one answer offers; typing more narrows the rest. */
export const MARKET_LINK_LIMIT = 20;
const MAX_LINK_SEARCH_LENGTH = 100;

const SEARCHED = sql`concat_ws(' ', ${marketSeedBook.nameAr}, ${marketSeedBook.nameEn}, ${marketSeedBook.leafNameAr}, ${marketSeedBook.leafNameEn})`;

function fieldOf(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}

/** The active market items in the cost item's own unit matching `query` (empty: the first ones, in book order). */
export async function searchMarketLinksCore(ctx: OrgContext, input: unknown): Promise<ActionResult & { data?: MarketLinkSearch }> {
  if (!can(ctx.role, 'price_book', 'update')) return err('forbidden');
  const costItemId = fieldOf(input, 'costItemId');
  const query = fieldOf(input, 'query');
  if (!isUuid(costItemId) || typeof query !== 'string') return err('malformed');
  try {
    const data = await withOrgContext(ctx, async (tx) => {
      const [item] = await tx.select({ unit: costItems.unit }).from(costItems).where(eq(costItems.id, costItemId)).limit(1);
      if (!item) return null;
      const rows = await tx
        .select({
          id: marketSeedBook.itemId,
          nameAr: marketSeedBook.nameAr,
          nameEn: marketSeedBook.nameEn,
          leafNameAr: marketSeedBook.leafNameAr,
          leafNameEn: marketSeedBook.leafNameEn,
          unitCost: marketSeedBook.unitCost,
        })
        .from(marketSeedBook)
        .where(
          and(
            eq(marketSeedBook.status, 'active'),
            eq(marketSeedBook.unit, item.unit),
            everyWordSql(SEARCHED, cleanSearchQuery(query, MAX_LINK_SEARCH_LENGTH)),
          ),
        )
        .orderBy(asc(marketSeedBook.position))
        .limit(MARKET_LINK_LIMIT + 1);
      return { items: rows.slice(0, MARKET_LINK_LIMIT), more: rows.length > MARKET_LINK_LIMIT };
    });
    return data ? { ok: true, data } : err('record_not_found');
  } catch (error) {
    return unexpectedFailure('market link search failed', error);
  }
}
