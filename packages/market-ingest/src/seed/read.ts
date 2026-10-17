// The privileged reads of the seed, on the owner's connection (no org
// context): the published market items with their latest numeric price, the
// studios, and each studio's actor. Read-only. Everything a studio row is
// written from runs later inside that studio's RLS transaction.
import type { PostgresJs } from '../db/connection';
import { packOf } from '../history/load';
import type { MarketSeedItem } from './types';

/**
 * Every item a published bulletin prices (what studios can see), in the
 * taxonomy's display order. `latestPrice` is the newest month whose EFFECTIVE
 * value (the newest published bulletin reporting that month) is a number: a
 * suspended or empty month is skipped for the one before it.
 */
export async function readMarketSeedItems(sql: PostgresJs): Promise<MarketSeedItem[]> {
  const rows = await sql<Array<Record<string, string | number | null>>>`
    with effective as (
      select distinct on (o.item_id, o.period_month) o.item_id, o.period_month, o.status, o.price
        from market_price_observations o
        join market_bulletins b on b.id = o.bulletin_id and b.status = 'published'
       order by o.item_id, o.period_month, b.period_month desc
    ), latest as (
      select distinct on (item_id) item_id, price
        from effective where status = 'priced'
       order by item_id, period_month desc
    )
    select i.id, i.key, i.name_ar, i.name_en, i.spec_ar, i.spec_en, i.unit, i.status,
           i.pack_length_m, i.pack_pieces, i.pack_piece_length_m,
           c.key as leaf_key, c.name_ar as leaf_name_ar, c.name_en as leaf_name_en,
           t.name_ar as top_name_ar, t.name_en as top_name_en, l.price::text as latest_price
      from market_items i
      join market_categories c on c.id = i.category_id
      join market_categories t on t.id = c.parent_id
      left join latest l on l.item_id = i.id
     where exists (select 1 from effective e where e.item_id = i.id)
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
