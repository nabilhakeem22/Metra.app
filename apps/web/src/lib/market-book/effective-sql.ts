import 'server-only';
import { sql, type SQL } from 'drizzle-orm';

// The SQL both market reads share. Every name here is RLS-scoped by the
// caller's org context: market_bulletins shows only published bulletins,
// market_items only items a published bulletin prices, cost_items only this
// studio's rows. Explicit columns only: the bulletin's file names, hashes,
// reviewer and gate commit never leave the database on a studio read.

/**
 * One row per (item, month): the EFFECTIVE value, i.e. the newest published
 * bulletin that reports the month (every bulletin restates the year so far, and
 * a withdrawn one falls back to the one before it).
 *
 * No join to market_bulletins: the observations policy already shows a row only
 * through a PUBLISHED bulletin (market-book.dbtest.ts: "even without the
 * join"), and the row carries its bulletin's month. Without the join the
 * planner has one path, the (item_id, period_month) index, and `itemIds` (a
 * uuid[]) and `fromMonth` (a `date`), each one value (an InitPlan), are both
 * conditions of it whatever the row estimates (R5: a timestamp bound fell out).
 */
export function effectiveSql(itemIds: SQL, fromMonth: SQL | null): SQL {
  return sql`
    select distinct on (o.item_id, o.period_month)
           o.item_id, o.period_month, o.status, o.price,
           coalesce(o.source_printed_page, o.source_pdf_page) as page, o.bulletin_period_month as bulletin_month
      from market_price_observations o
     where o.item_id = any(${itemIds}) ${fromMonth ? sql`and o.period_month >= ${fromMonth}` : sql``}
     order by o.item_id, o.period_month, o.bulletin_period_month desc`;
}

/** A point as ./decode.ts reads it: [month, status, price, bulletin month, page]. `e` is an effectiveSql row. */
export const POINT_JSON = sql`json_build_array(to_char(e.period_month, 'YYYY-MM'), e.status, e.price::text,
  to_char(e.bulletin_month, 'YYYY-MM'), e.page)`;

/**
 * An item as ./decode.ts reads it (ITEM_FIELDS order), `i` a market_items row
 * joined to its leaf `c`, and `series` the item's points. The studio's own
 * linked price-book item comes from a lateral join named `linked`.
 */
export function itemJson(series: SQL): SQL {
  return sql`json_build_array(i.id, i.key, c.key, i.name_ar, i.name_en, i.spec_ar, i.spec_en, i.unit, i.unit_label_ar,
    i.basis_note_ar, i.status, linked.id, linked.code, ${series})`;
}

/** The studio's item linked to market item `i` (the active one first): at most one row. */
export const LINKED_COST_ITEM = sql`left join lateral (
    select ci.id, ci.code from cost_items ci
     where ci.market_item_id = i.id
     order by ci.active desc, ci.created_at, ci.id
     limit 1) linked on true`;
