// The stored seed book (market_seed_book) the app seeds a studio from: rebuilt
// WHOLE from what is published, by the one seed implementation
// (@metra/db/market-seed), inside the transaction that changed what is
// published (market:publish, market:withdraw) or under the same market write
// lock (market:seed-price-books). The owner's connection writes it; metra_app
// can only read it.
import { buildSeedBook, type SeedBookEntry } from '@metra/db/market-seed';
import { MIGRATION_LOCK_TIMEOUT } from '@metra/db/lock-timeout';
import type { PostgresJs, Transaction } from '../db/connection';
import { MARKET_WRITE_LOCK } from '../publish/write-lock';
import { readMarketSeedItems } from './read';

async function storeSeedBook(tx: Transaction, book: SeedBookEntry[]): Promise<void> {
  await tx`delete from market_seed_book`;
  if (book.length === 0) return;
  const rows = JSON.stringify(book.map((entry, index) => ({
    item_id: entry.marketItemId,
    position: index + 1,
    code: entry.code,
    name_ar: entry.nameAr,
    name_en: entry.nameEn,
    name_forms: entry.nameForms,
    status: entry.status,
    unit: entry.unit,
    unit_cost: entry.unitCost,
    unit_price: entry.unitPrice,
    leaf_key: entry.leafKey,
    leaf_name_ar: entry.leafNameAr,
    leaf_name_en: entry.leafNameEn,
    top_name_ar: entry.topNameAr,
    top_name_en: entry.topNameEn,
  })));
  await tx`
    insert into market_seed_book (item_id, position, code, name_ar, name_en, name_forms, status, unit, unit_cost, unit_price,
                                  leaf_key, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en)
    select item_id, position, code, name_ar, name_en, name_forms, status, unit, unit_cost, unit_price,
           leaf_key, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en
      from jsonb_to_recordset(${rows}::text::jsonb) as e(item_id uuid, position integer, code text, name_ar text, name_en text,
             name_forms text[], status market_item_status, unit cost_item_unit, unit_cost numeric, unit_price numeric,
             leaf_key text, leaf_name_ar text, leaf_name_en text, top_name_ar text, top_name_en text)`;
}

/** Rebuild the stored book from what `tx` sees published; returns the book it stored. */
export async function refreshSeedBook(tx: Transaction): Promise<SeedBookEntry[]> {
  const book = buildSeedBook(await readMarketSeedItems(tx));
  await storeSeedBook(tx, book);
  return book;
}

/** The same rebuild in its own transaction, behind any publish or withdrawal in flight. */
export async function refreshSeedBookLocked(sql: PostgresJs): Promise<SeedBookEntry[]> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('lock_timeout', ${MIGRATION_LOCK_TIMEOUT}, true)`;
    await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
    return refreshSeedBook(tx);
  })) as SeedBookEntry[];
}
