import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { effectiveSql, itemJson, LINKED_COST_ITEM, POINT_JSON } from './effective-sql';

// One market item for its drawer, in ONE statement (one snapshot): the newest
// published bulletin's month, and the item with every effective month, newest
// MARKET_DETAIL_MONTHS of them (five years of monthly bulletins), so the drawer
// is bounded however long the history grows.

export const MARKET_DETAIL_MONTHS = 60;

export function marketItemSql(itemId: string): SQL {
  return sql`
    with effective as (
      ${effectiveSql(sql`(${itemId}::uuid)`, null)}
    ), newest as (
      select * from effective order by period_month desc limit ${MARKET_DETAIL_MONTHS}
    )
    select json_build_array(
      (select to_char(max(period_month), 'YYYY-MM') from market_bulletins),
      (select ${itemJson(sql`coalesce((select json_agg(${POINT_JSON} order by e.period_month) from newest e), '[]')`)}
         from market_items i
         join market_categories c on c.id = i.category_id
         ${LINKED_COST_ITEM}
        where i.id = ${itemId}::uuid)
    )::text as item`;
}
