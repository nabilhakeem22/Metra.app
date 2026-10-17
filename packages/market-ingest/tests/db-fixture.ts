// Fixtures for the market CLI's DB tests (LOCAL database only, see
// vitest.db.config.ts). Every item key carries `dbtest_` and every bulletin is
// reviewed by REVIEWER, so `clearMarketTestData` removes exactly what these
// tests wrote. Periods sit in 2003 and 2004, clear of any real bulletin.
import { createSql, type PostgresJs } from '@metra/db/client';
import type { RollPack } from '../src/roll-pack';

export const REVIEWER = 'market-ingest dbtest';

export function openTestDatabase(): PostgresJs {
  return createSql(process.env.DATABASE_URL as string, { max: 1 });
}

export interface SeedItem {
  key: string;
  unit: string;
  sourceLabel: string;
  pack?: RollPack;
  status?: 'active' | 'discontinued';
  /** ['YYYY-MM', price] */
  prices?: Array<[string, string]>;
}

async function leafId(sql: PostgresJs, leafKey: string): Promise<string> {
  const top = leafKey.split('.')[0];
  await sql`insert into market_categories (key, name_ar, name_en, sort_order) values (${top}, 'أعلى', 'Top', 1) on conflict (key) do nothing`;
  await sql`insert into market_categories (key, parent_id, name_ar, name_en, sort_order)
            select ${leafKey}, id, 'فرع', 'Leaf', 1 from market_categories where key = ${top} on conflict (key) do nothing`;
  const [row] = await sql<{ id: string }[]>`select id from market_categories where key = ${leafKey}`;
  return row.id;
}

/** A published bulletin for `period` carrying `items` (created when absent). */
export async function seedPublished(
  sql: PostgresJs,
  period: string,
  items: SeedItem[],
  source: { pdfSha256?: string } = {},
): Promise<string> {
  const [bulletin] = await sql<{ id: string }[]>`
    insert into market_bulletins (publisher, period_month, status, source_pdf_file_name, source_pdf_sha256,
      source_page_count, extraction_method, extraction_sha256, reviewed_by, reviewed_at)
    values ('mhuc_cabm', ${`${period}-01`}, 'published', 'seed.pdf', ${source.pdfSha256 ?? 'c'.repeat(64)},
      113, 'session:pdf', ${'d'.repeat(64)}, ${REVIEWER}, now())
    returning id`;
  for (const item of items) {
    const categoryId = await leafId(sql, item.key.split('.').slice(0, 2).join('.'));
    const [row] = await sql<{ id: string }[]>`
      insert into market_items (key, category_id, name_ar, name_en, unit, unit_label_ar, source_labels, status,
        pack_length_m, pack_pieces, pack_piece_length_m)
      values (${item.key}, ${categoryId}, 'بند', 'Item', ${item.unit}::market_unit, 'طن', ${[item.sourceLabel]},
        ${item.status ?? 'active'}::market_item_status, ${item.pack?.lengthM ?? null}, ${item.pack?.pieces ?? null},
        ${item.pack?.pieceLengthM ?? null})
      on conflict (key) do update set updated_at = now()
      returning id`;
    for (const [month, price] of item.prices ?? []) {
      await sql`insert into market_price_observations (item_id, bulletin_id, period_month, status, price, source_pdf_page)
                values (${row.id}, ${bulletin.id}, ${`${month}-01`}, 'priced', ${price}, 1)`;
    }
  }
  return bulletin.id;
}

export async function clearMarketTestData(sql: PostgresJs): Promise<void> {
  await sql`delete from market_price_observations o using market_items i
             where i.id = o.item_id and i.key like '%.dbtest\\_%'`;
  await sql`delete from market_price_observations o using market_bulletins b
             where b.id = o.bulletin_id and (b.reviewed_by = ${REVIEWER} or extract(year from b.period_month) in (2003, 2004))`;
  await sql`delete from market_bulletins where reviewed_by = ${REVIEWER} or extract(year from period_month) in (2003, 2004)`;
  await sql`delete from market_items where key like '%.dbtest\\_%'`;
}
