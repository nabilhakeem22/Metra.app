// The seed's reads and its one write, inside a studio's RLS transaction
// (withOrgContext: metra_app, the studio's org and actor in the GUCs). Shared
// by the owner's CLI and the app, so a studio seeded either way gets the same
// rows and the same audit trail. Inserts only: no studio row is ever updated or
// deleted, and RLS, the FKs and every CHECK apply exactly as for the app's own
// creates (lib/price-book/core.ts, lib/sections/core.ts).
import { sql } from 'drizzle-orm';
import type { MetraDb } from '../client';
import { costItems, sections } from '../schema';
import type { SeedBookEntry, SeedPlan, StudioBook } from './types';

/** What the studio already has, as the plan reads it. */
export async function readStudioBook(tx: MetraDb): Promise<StudioBook> {
  return {
    sections: await tx.select({ id: sections.id, key: sections.key, nameAr: sections.nameAr, nameEn: sections.nameEn }).from(sections),
    items: await tx.select({ code: costItems.code, nameAr: costItems.nameAr, nameEn: costItems.nameEn, marketItemId: costItems.marketItemId }).from(costItems),
  };
}

type StoredLeaf = [leafNameAr: string, leafNameEn: string, topNameAr: string, topNameEn: string];
type StoredEntry = [string, string, string, string, string[], SeedBookEntry['status'], SeedBookEntry['unit'], string | null, string | null, string];

/**
 * The stored seed book (market_seed_book), in its order. ONE row of ONE text
 * value, parsed by JSON.parse: the cheapest way a Worker can receive 450
 * entries. Each sub-category's names travel once, and the name forms only when
 * `withNameForms` (`canClashByName`: a studio with no item of its own cannot
 * clash, so a new studio reads a quarter less). Empty when no bulletin is published, or the book
 * was never built.
 */
export async function readSeedBook(tx: MetraDb, withNameForms: boolean): Promise<SeedBookEntry[]> {
  const rows = (await tx.execute(sql`
    select json_build_array(
             coalesce((select json_object_agg(leaf_key, json_build_array(leaf_name_ar, leaf_name_en, top_name_ar, top_name_en))
                         from (select distinct leaf_key, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en from market_seed_book) leaves), '{}'),
             coalesce((select json_agg(json_build_array(item_id, code, name_ar, name_en,
                                case when ${withNameForms} then name_forms else '{}'::text[] end,
                                status, unit, unit_cost::text, unit_price::text, leaf_key) order by position)
                         from market_seed_book), '[]'))::text as book`)) as unknown as Array<{ book: string }>;
  const [leaves, entries] = JSON.parse(rows[0].book) as [Record<string, StoredLeaf>, StoredEntry[]];
  return entries.map(([marketItemId, code, nameAr, nameEn, nameForms, status, unit, unitCost, unitPrice, leafKey]) => {
    const [leafNameAr, leafNameEn, topNameAr, topNameEn] = leaves[leafKey];
    return { marketItemId, code, nameAr, nameEn, nameForms, status, unit, unitCost, unitPrice, leafKey, leafNameAr, leafNameEn, topNameAr, topNameEn };
  });
}

export interface SeedWritten {
  sections: number;
  items: number;
}

/**
 * Writes `plan` in ONE set-based statement: the new sections, the cost items
 * (into a new section by its key, or an existing one by id), and an audit row
 * for each, marked with `source`. The rows travel as two JSON parameters, so
 * the Worker builds no per-row SQL. Nothing to write is no statement at all.
 */
export async function writeSeedPlan(tx: MetraDb, plan: SeedPlan, source: string): Promise<SeedWritten> {
  if (plan.sectionsToCreate.length === 0 && plan.itemsToCreate.length === 0) return { sections: 0, items: 0 };
  const sectionRows = JSON.stringify(plan.sectionsToCreate.map((section) => ({ key: section.key, name_ar: section.nameAr, name_en: section.nameEn })));
  const itemRows = JSON.stringify(plan.itemsToCreate.map((item) => ({
    market_item_id: item.marketItemId,
    section_id: 'id' in item.section ? item.section.id : null,
    section_key: 'key' in item.section ? item.section.key : null,
    code: item.code,
    name_ar: item.nameAr,
    name_en: item.nameEn,
    unit: item.unit,
    cost: item.defaultUnitCost,
    price: item.defaultUnitPrice,
  })));
  const rows = (await tx.execute(sql`
    with actor as (
      select current_setting('app.current_org_id', true)::uuid as org_id,
             current_setting('app.current_user_id', true)::uuid as user_id
    ), new_sections as (
      insert into sections (org_id, key, name_ar, name_en)
      select actor.org_id, s.key, s.name_ar, s.name_en
        from actor, jsonb_to_recordset(${sectionRows}::text::jsonb) as s(key text, name_ar text, name_en text)
      returning id, key, name_ar, name_en
    ), section_audit as (
      insert into audit_log (org_id, actor_user_id, entity, entity_id, action, before, after)
      select actor.org_id, actor.user_id, 'section', n.id, 'create', null,
             jsonb_build_object('name_en', n.name_en, 'name_ar', n.name_ar, 'key', n.key, 'source', ${source}::text)
        from actor, new_sections n
    ), new_items as (
      insert into cost_items (org_id, code, name_ar, name_en, section_id, unit, default_unit_cost, default_unit_price, market_item_id)
      select actor.org_id, i.code, i.name_ar, i.name_en, coalesce(i.section_id, n.id), i.unit, i.cost, i.price, i.market_item_id
        from actor, jsonb_to_recordset(${itemRows}::text::jsonb) as i(market_item_id uuid, section_id uuid, section_key text, code text,
               name_ar text, name_en text, unit cost_item_unit, cost numeric, price numeric)
        left join new_sections n on n.key = i.section_key
      returning id, code, name_ar, name_en, section_id, unit, market_item_id, default_unit_cost, default_unit_price
    ), item_audit as (
      insert into audit_log (org_id, actor_user_id, entity, entity_id, action, before, after)
      select actor.org_id, actor.user_id, 'cost_item', c.id, 'create', null,
             jsonb_build_object('code', c.code, 'nameEn', c.name_en, 'nameAr', c.name_ar, 'section_id', c.section_id, 'unit', c.unit,
               'market_item_id', c.market_item_id, 'default_unit_cost', c.default_unit_cost::text,
               'default_unit_price', c.default_unit_price::text, 'source', ${source}::text)
        from actor, new_items c
    )
    select (select count(*)::int from new_sections) as sections, (select count(*)::int from new_items) as items`)) as unknown as SeedWritten[];
  return rows[0];
}
