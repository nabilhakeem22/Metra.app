// Market price book fixtures for the action-core DB tests. The market tables
// are platform-level (no org_id), so the org teardown in fixture.ts never
// touches them: every row seeded here is tracked and removed by `clearMarket`,
// which a suite calls AFTER its org teardown (cost_items reference market_items
// on delete restrict). Writes go over a BYPASSRLS connection, exactly as the
// owner's `market:publish` does.
import { randomUUID } from 'node:crypto';
import { createSql } from '@metra/db';

const pg = createSql(process.env.DATABASE_URL as string, { max: 2, prepare: false });

const seeded = { bulletins: new Set<string>(), items: new Set<string>() };

/** The leaf every fixture item sits under; upserted, never deleted (shared with real data). */
const CATEGORY = { top: 'finishing', leaf: 'finishing.glass' };

async function categoryId(): Promise<string> {
  await pg`insert into public.market_categories (key, name_ar, name_en, sort_order)
           values (${CATEGORY.top}, 'خامات التشطيب', 'Finishing materials', 1) on conflict (key) do nothing`;
  await pg`insert into public.market_categories (key, parent_id, name_ar, name_en, sort_order)
           select ${CATEGORY.leaf}, id, 'الزجاج', 'Glass', 4 from public.market_categories where key = ${CATEGORY.top}
           on conflict (key) do nothing`;
  const [row] = await pg<{ id: string }[]>`select id from public.market_categories where key = ${CATEGORY.leaf}`;
  return row.id;
}

/** A fresh market item (unit sqm unless given); its key is unique to this run. */
export async function seedMarketItem(unit = 'sqm'): Promise<{ id: string; key: string }> {
  const key = `${CATEGORY.leaf}.dbtest_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const [row] = await pg<{ id: string }[]>`
    insert into public.market_items (key, category_id, name_ar, name_en, unit, unit_label_ar)
    values (${key}, ${await categoryId()}, 'زجاج شفاف', 'Clear glass', ${unit}::market_unit, 'م2')
    returning id`;
  seeded.items.add(row.id);
  return { id: row.id, key };
}

/** A published (or withdrawn) bulletin for `period` ('YYYY-MM') with one price per [itemId, 'YYYY-MM', price]. */
export async function seedBulletin(
  period: string,
  observations: Array<[itemId: string, month: string, price: string]>,
): Promise<string> {
  const [bulletin] = await pg<{ id: string }[]>`
    insert into public.market_bulletins
      (publisher, period_month, status, source_pdf_file_name, source_pdf_sha256, source_page_count,
       extraction_method, extraction_sha256, reviewed_by, reviewed_at)
    values ('mhuc_cabm', ${`${period}-01`}, 'published', 'dbtest.pdf', ${'a'.repeat(64)}, 113,
            'session:pdf', ${'b'.repeat(64)}, 'dbtest', now())
    returning id`;
  seeded.bulletins.add(bulletin.id);
  for (const [itemId, month, price] of observations) {
    await pg`insert into public.market_price_observations (item_id, bulletin_id, period_month, status, price, source_pdf_page)
             values (${itemId}, ${bulletin.id}, ${`${month}-01`}, 'priced', ${price}, 1)`;
  }
  return bulletin.id;
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

/** Removes every bulletin, observation and item this process seeded. */
export async function clearMarket(): Promise<void> {
  const bulletins = [...seeded.bulletins];
  const items = [...seeded.items];
  await pg`delete from public.market_price_observations where bulletin_id = any(${bulletins}::uuid[]) or item_id = any(${items}::uuid[])`;
  await pg`delete from public.market_bulletins where id = any(${bulletins}::uuid[])`;
  await pg`delete from public.market_items where id = any(${items}::uuid[])`;
  seeded.bulletins.clear();
  seeded.items.clear();
}

export async function closeMarketFixture(): Promise<void> {
  try {
    await clearMarket();
  } finally {
    await pg.end();
  }
}
