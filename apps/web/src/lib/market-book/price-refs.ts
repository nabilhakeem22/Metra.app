import 'server-only';
import type { CostItemUnit, MarketUnit } from '@metra/db';
import { sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { decodeBulletin, type BulletinTuple } from './decode';
import { latestPricedSql } from './effective-sql';
import type { MarketPriceRef, PriceBookMarketColumn } from './types';
import { marketVariance } from './variance';

// The price book's Market column (market plan task 18): for ONE page of the
// book (at most PRICE_BOOK_PAGE_SIZE items), the newest published bulletin
// and each linked item's market price, in one statement. Bounded by the page,
// never by the book: the ids are the page's own linked items, never the
// studio's whole set. Read-only; a price is never written from here.

/** A price book row as the column reads it. */
export interface MarketColumnRow {
  id: string;
  unit: CostItemUnit;
  defaultUnitCost: string;
  marketItemId: string | null;
}

type ItemTuple = [id: string, nameAr: string, nameEn: string, unit: MarketUnit, unitLabelAr: string, month: string | null, price: string | null];

function columnSql(itemIds: string[]) {
  return sql`
    select json_build_array(
      (select json_build_array(to_char(period_month, 'YYYY-MM'), published_at, collection_from_day, collection_to_day, region_key)
         from market_bulletins order by period_month desc limit 1),
      coalesce((select json_agg(json_build_array(i.id, i.name_ar, i.name_en, i.unit, i.unit_label_ar,
                                                 to_char(priced.period_month, 'YYYY-MM'), priced.price::text))
                  from market_items i
                  left join lateral (${latestPricedSql(sql`i.id`)}) priced on true
                 where i.id = any(${`{${itemIds.join(',')}}`}::uuid[])), '[]')
    )::text as column`;
}

/** The column of the page `rows`: no bulletin at all hides it (plan AC 18). */
export async function readMarketColumn(ctx: OrgContext, rows: readonly MarketColumnRow[]): Promise<PriceBookMarketColumn> {
  const itemIds = [...new Set(rows.flatMap((row) => (row.marketItemId ? [row.marketItemId] : [])))];
  const answer = (await withOrgContext(ctx, (tx) => tx.execute(columnSql(itemIds)))) as unknown as Array<{ column: string }>;
  const [bulletin, items] = JSON.parse(answer[0].column) as [BulletinTuple | null, ItemTuple[]];
  const byId = new Map(items.map((item) => [item[0], item]));
  const refs: Record<string, MarketPriceRef> = {};
  for (const row of rows) {
    const item = row.marketItemId ? byId.get(row.marketItemId) : undefined;
    if (!item) continue;
    const [marketItemId, nameAr, nameEn, unit, unitLabelAr, month, price] = item;
    const variance = marketVariance({ unit: row.unit, unitCost: row.defaultUnitCost }, { unit, price });
    refs[row.id] = { marketItemId, nameAr, nameEn, unit, unitLabelAr, price, month, ...variance };
  }
  return { bulletin: decodeBulletin(bulletin), refs };
}
