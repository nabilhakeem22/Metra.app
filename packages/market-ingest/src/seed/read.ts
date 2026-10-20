// The privileged reads of the seed, on the owner's connection (no org
// context): the published market items with their latest numeric price, the
// studios, and each studio's actor. Read-only. Everything a studio row is
// written from runs later inside that studio's RLS transaction.
import type { MarketSeedItem } from '@metra/db/market-seed';
import type { PostgresJs, Queryable } from '../db/connection';
import { packOf } from '../history/load';

/**
 * Every item a published bulletin prices (what studios can see), in the
 * taxonomy's display order. `latestPrice` is the newest month whose EFFECTIVE
 * value (the newest published bulletin reporting that month) is a number: a
 * suspended or empty month is skipped for the one before it.
 *
 * Read item by item, newest month first, down the (item_id, period_month)
 * index: an observation is the month's effective one when no published
 * bulletin newer than its own reports the month, and the first priced one is
 * the answer. So the read stops at the item's newest priced month however many
 * bulletins restate its history (R2: a DISTINCT ON over every observation took
 * 2 s at 121 bulletins, inside the market write lock). A bulletin counts unless
 * it is withdrawn: the few withdrawn ids are tested, so no list of every
 * published bulletin is sorted for each item.
 */
export async function readMarketSeedItems(sql: Queryable): Promise<MarketSeedItem[]> {
  const rows = await sql<Array<Record<string, string | number | null>>>`
    with withdrawn as materialized (
      select coalesce(array_agg(id), '{}') as ids from market_bulletins where status <> 'published'
    )
    select i.id, i.key, i.name_ar, i.name_en, i.spec_ar, i.spec_en, i.unit, i.status,
           i.pack_length_m, i.pack_pieces, i.pack_piece_length_m,
           c.key as leaf_key, c.name_ar as leaf_name_ar, c.name_en as leaf_name_en,
           t.name_ar as top_name_ar, t.name_en as top_name_en, l.price::text as latest_price
      from market_items i
      join market_categories c on c.id = i.category_id
      join market_categories t on t.id = c.parent_id
      left join lateral (
        select o.price
          from market_price_observations o
         where o.item_id = i.id and o.status = 'priced' and o.bulletin_id <> all((select ids from withdrawn)::uuid[])
           and o.bulletin_period_month = (select max(newest.bulletin_period_month) from market_price_observations newest
                                           where newest.item_id = o.item_id and newest.period_month = o.period_month
                                             and newest.bulletin_id <> all((select ids from withdrawn)::uuid[]))
         order by o.period_month desc
         limit 1) l on true
     where exists (select 1 from market_price_observations o where o.item_id = i.id and o.bulletin_id <> all((select ids from withdrawn)::uuid[]))
     order by t.sort_order, c.sort_order, i.key collate "C"`;
  return rows.map((row) => ({
    id: row.id as string,
    key: row.key as string,
    nameAr: row.name_ar as string,
    nameEn: row.name_en as string,
    specAr: row.spec_ar as string | null,
    specEn: row.spec_en as string | null,
    unit: row.unit as MarketSeedItem['unit'],
    pack: packOf(row as Parameters<typeof packOf>[0]),
    status: row.status as MarketSeedItem['status'],
    leafKey: row.leaf_key as string,
    leafNameAr: row.leaf_name_ar as string,
    leafNameEn: row.leaf_name_en as string,
    topNameAr: row.top_name_ar as string,
    topNameEn: row.top_name_en as string,
    latestPrice: row.latest_price as string | null,
  }));
}

export interface Studio {
  id: string;
  name: string;
}

export async function readStudios(sql: PostgresJs, only: string[]): Promise<Studio[]> {
  const rows = await sql<Array<{ id: string; name_en: string | null; name_ar: string | null }>>`
    select id, name_en, name_ar from organizations
     where ${only.length === 0} or id = any(${only}::uuid[])
     order by created_at, id`;
  return rows.map((row) => ({ id: row.id, name: row.name_en ?? row.name_ar ?? '' }));
}

/**
 * The studio's actor, as the app's automation resolves its system actor
 * (apps/web/src/lib/automation/system-context.ts): the earliest owner
 * membership, else the earliest admin; null when the studio has neither. Both
 * roles hold price_book create in the capability matrix.
 */
export async function readActor(sql: PostgresJs, orgId: string): Promise<{ userId: string; role: 'owner' | 'admin' } | null> {
  const rows = await sql<Array<{ user_id: string; role: 'owner' | 'admin' }>>`
    select user_id, role from memberships
     where org_id = ${orgId} and role in ('owner', 'admin')
     order by created_at, id`;
  const actor = rows.find((row) => row.role === 'owner') ?? rows.find((row) => row.role === 'admin');
  return actor ? { userId: actor.user_id, role: actor.role } : null;
}
