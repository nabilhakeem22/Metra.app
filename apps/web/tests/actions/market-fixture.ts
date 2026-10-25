// Market price book fixtures for the action-core DB tests. The market tables
// are platform-level (no org_id), so the org teardown in fixture.ts never
// touches them: every row seeded here is tracked and removed by `clearMarket`,
// which a suite calls AFTER its org teardown (cost_items reference market_items
// on delete restrict). Writes go over a BYPASSRLS connection, exactly as the
// owner's `market:publish` does.
import { randomUUID } from 'node:crypto';
import { createSql } from '@metra/db';

const pg = createSql(process.env.DATABASE_URL as string, { max: 2, prepare: false });

const seeded = { bulletins: new Set<string>(), items: new Set<string>(), leaves: new Set<string>() };

/** A leaf of the finishing category. One that exists already (shared with real data) is never deleted; one this process created is. */
export interface MarketLeaf {
  key: string;
  nameAr: string;
  nameEn: string;
}

/** The leaf every fixture item sits under unless it names another. */
const GLASS_LEAF: MarketLeaf = { key: 'finishing.glass', nameAr: 'الزجاج', nameEn: 'Glass' };
const TOP_KEY = 'finishing';

async function categoryId(leaf: MarketLeaf): Promise<string> {
  await pg`insert into public.market_categories (key, name_ar, name_en, sort_order)
           values (${TOP_KEY}, 'خامات التشطيب', 'Finishing materials', 1) on conflict (key) do nothing`;
  const created = await pg<{ id: string }[]>`insert into public.market_categories (key, parent_id, name_ar, name_en, sort_order)
           select ${leaf.key}, id, ${leaf.nameAr}, ${leaf.nameEn}, 4 from public.market_categories where key = ${TOP_KEY}
           on conflict (key) do nothing returning id`;
  if (leaf.key !== GLASS_LEAF.key) created.forEach(({ id }) => seeded.leaves.add(id));
  const [row] = await pg<{ id: string }[]>`select id from public.market_categories where key = ${leaf.key}`;
  return row.id;
}

export interface MarketItemOptions {
  nameAr?: string;
  nameEn?: string;
  specAr?: string;
  specEn?: string;
  /** A roll's one-length pack, in metres (a roll needs one). */
  packLengthM?: number;
  status?: 'active' | 'discontinued';
  /** The leaf it sits in (a `finishing.<name>` key); Glass unless given. */
  leaf?: MarketLeaf;
}

/** A fresh market item (unit sqm unless given); its key is unique to this run. */
export async function seedMarketItem(unit = 'sqm', options: MarketItemOptions = {}): Promise<{ id: string; key: string }> {
  const leaf = options.leaf ?? GLASS_LEAF;
  const key = `${leaf.key}.dbtest_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const [row] = await pg<{ id: string }[]>`
    insert into public.market_items (key, category_id, name_ar, name_en, spec_ar, spec_en, unit, unit_label_ar, pack_length_m, status)
    values (${key}, ${await categoryId(leaf)}, ${options.nameAr ?? 'زجاج شفاف'}, ${options.nameEn ?? 'Clear glass'},
            ${options.specAr ?? null}, ${options.specEn ?? null}, ${unit}::market_unit, 'م2',
            ${options.packLengthM ?? null}, ${options.status ?? 'active'}::market_item_status)
    returning id`;
  seeded.items.add(row.id);
  return { id: row.id, key };
}

/**
 * A published (or withdrawn) bulletin for `period` ('YYYY-MM') with one price
 * per [itemId, 'YYYY-MM', price]; a null price is a suspended month.
 */
export async function seedBulletin(
  period: string,
  observations: Array<[itemId: string, month: string, price: string | null]>,
): Promise<string> {
  const [bulletin] = await pg<{ id: string }[]>`
    insert into public.market_bulletins
      (publisher, period_month, status, source_pdf_file_name, source_pdf_sha256, source_page_count,
       extraction_method, extraction_sha256, gate_commit, reviewed_by, reviewed_at)
    values ('mhuc_cabm', ${`${period}-01`}, 'published', 'dbtest.pdf', ${'a'.repeat(64)}, 113,
            'session:pdf', ${'b'.repeat(64)}, ${'c'.repeat(40)}, 'dbtest', now())
    returning id`;
  seeded.bulletins.add(bulletin.id);
  for (const [itemId, month, price] of observations) {
    await pg`insert into public.market_price_observations (item_id, bulletin_id, bulletin_period_month, period_month, status, price, source_pdf_page)
             values (${itemId}, ${bulletin.id}, ${`${period}-01`}, ${`${month}-01`}, ${price === null ? 'suspended' : 'priced'}::market_observation_status, ${price}, 1)`;
  }
  return bulletin.id;
}

/** The item's details as `bulletinId` printed them. */
export async function seedDetails(itemId: string, bulletinId: string): Promise<void> {
  await pg`insert into public.market_item_details (item_id, bulletin_id, name_ar, name_en, unit_label_ar)
           values (${itemId}, ${bulletinId}, 'زجاج شفاف', 'Clear glass', 'م2')`;
}

export async function withdrawBulletin(bulletinId: string): Promise<void> {
  await pg`update public.market_bulletins set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = 'dbtest'
           where id = ${bulletinId}`;
}

/** Statements over the BYPASSRLS connection, for the constraint cases. */
export function marketRaw(): typeof pg {
  return pg;
}

/**
 * Run `query` as metra_app with the given GUCs and NOTHING else, inside a
 * transaction that is always rolled back: the shape of a request with no org
 * context, or with a forged one.
 */
export async function asAppRole<T>(gucs: Record<string, string>, query: string): Promise<T[]> {
  const result: T[] = [];
  await pg
    .begin(async (tx) => {
      for (const [name, value] of Object.entries(gucs)) await tx`select set_config(${name}, ${value}, true)`;
      await tx.unsafe('set local role metra_app');
      result.push(...((await tx.unsafe(query)) as unknown as T[]));
      throw new RolledBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
  return result;
}

class RolledBack extends Error {}

/** Removes every bulletin, observation, item and leaf this process seeded. */
export async function clearMarket(): Promise<void> {
  const bulletins = [...seeded.bulletins];
  const items = [...seeded.items];
  await pg`delete from public.market_price_observations where bulletin_id = any(${bulletins}::uuid[]) or item_id = any(${items}::uuid[])`;
  await pg`delete from public.market_item_details where bulletin_id = any(${bulletins}::uuid[]) or item_id = any(${items}::uuid[])`;
  await pg`delete from public.market_bulletins where id = any(${bulletins}::uuid[])`;
  await pg`delete from public.market_items where id = any(${items}::uuid[])`;
  await pg`delete from public.market_categories where id = any(${[...seeded.leaves]}::uuid[])`;
  seeded.bulletins.clear();
  seeded.items.clear();
  seeded.leaves.clear();
}

export async function closeMarketFixture(): Promise<void> {
  try {
    await clearMarket();
  } finally {
    await pg.end();
  }
}
