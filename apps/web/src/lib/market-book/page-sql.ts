import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { nameInSql, nameSortKeySql } from '@/lib/price-book/search-sql';
import { everyWordSql } from '@/lib/search/words-sql';
import { effectiveSql, itemJson, LINKED_COST_ITEM, POINT_JSON } from './effective-sql';
import { MARKET_CATEGORY_LIMIT, MARKET_SEARCH_LIMIT, type MarketBookView } from './page-params';

// /market-book in ONE statement (R6: one snapshot, so a withdrawal between two
// reads can never show "Latest bulletin: September" over a series ending in
// August), answered as ONE text value the Worker parses once (R4: each item's
// 13-month series is aggregated here, never 13 rows per item in JS).
//
// Bounded whatever the book's size: the categories are the taxonomy (63 rows),
// and the items are one leaf (at most MARKET_CATEGORY_LIMIT) or one search (at
// most MARKET_SEARCH_LIMIT). The series reads only months from "latest minus
// 12", bound as a date (R5) through an InitPlan, so the index keeps the bound.

/** What a search looks in: names, specs, and the item's own sub-category names. */
const SEARCHED_TEXT = sql`concat_ws(' ', i.name_ar, i.name_en, i.spec_ar, i.spec_en, c.name_ar, c.name_en)`;

function matchingItems(view: MarketBookView): { where: SQL; limit: number } {
  const words = everyWordSql(SEARCHED_TEXT, view.query);
  return words
    ? { where: words, limit: MARKET_SEARCH_LIMIT }
    : { where: sql`c.key = (select key from chosen)`, limit: MARKET_CATEGORY_LIMIT };
}

export function marketBookPageSql(view: MarketBookView, locale: string): SQL {
  const items = matchingItems(view);
  const searching = view.query !== '';
  const order = sql`t.sort_order, c.sort_order,
    ${nameSortKeySql(nameInSql(sql`i.name_ar`, sql`i.name_en`, locale), locale)},
    ${nameSortKeySql(nameInSql(sql`i.spec_ar`, sql`i.spec_en`, locale), locale)}, i.id`;
  return sql`
    with bulletin as (
      select period_month, published_at, collection_from_day, collection_to_day, region_key
        from market_bulletins order by period_month desc limit 1
    ), counts as (
      select category_id, count(*)::int as n from market_items group by category_id
    ), categories as (
      select c.key, c.name_ar, c.name_en, p.key as parent_key, c.parent_id, c.sort_order,
             coalesce(p.sort_order, c.sort_order) as top_order,
             case when c.parent_id is null then (sum(coalesce(k.n, 0)) over (partition by coalesce(c.parent_id, c.id)))::int
                  else coalesce(k.n, 0) end as n
        from market_categories c
        left join market_categories p on p.id = c.parent_id
        left join counts k on k.category_id = c.id
    ), chosen as (
      select key from categories
       where ${searching ? sql`false` : sql`true`} and parent_id is not null and n > 0
       order by key = ${view.categoryKey ?? ''} desc, top_order, sort_order
       limit 1
    ), ranked as (
      select i.id, (count(*) over ())::int as matched, row_number() over (order by ${order}) as position
        from market_items i
        join market_categories c on c.id = i.category_id
        join market_categories t on t.id = c.parent_id
       where ${items.where}
    ), picked as (
      select id, matched, position from ranked where position <= ${items.limit}
    ), effective as (
      ${effectiveSql(sql`(select id from picked)`, sql`(select (period_month - interval '12 months')::date from bulletin)`)}
    ), series as (
      select e.item_id, json_agg(${POINT_JSON} order by e.period_month) as points from effective e group by e.item_id
    )
    select json_build_array(
      (select json_build_array(to_char(period_month, 'YYYY-MM'), published_at, collection_from_day, collection_to_day, region_key)
         from bulletin),
      coalesce((select json_agg(json_build_array(key, name_ar, name_en, parent_key, n) order by top_order, parent_id is not null, sort_order)
                  from categories), '[]'),
      (select key from chosen),
      coalesce((select max(matched) from picked), 0),
      coalesce((select json_agg(${itemJson(sql`coalesce(s.points, '[]')`)} order by p.position)
                  from picked p
                  join market_items i on i.id = p.id
                  join market_categories c on c.id = i.category_id
                  left join series s on s.item_id = i.id
                  ${LINKED_COST_ITEM}), '[]')
    )::text as page`;
}
