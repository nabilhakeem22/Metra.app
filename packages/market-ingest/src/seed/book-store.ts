// The stored seed book (market_seed_book) the app seeds a studio from: rebuilt
// WHOLE from what is published, by the one seed implementation
// (@metra/db/market-seed), inside the transaction that changed what is
// published (market:publish, market:withdraw) or under the same market write
// lock (market:rebuild-seed-book, and market:seed-price-books before it seeds).
// The owner's connection writes it; metra_app can only read it.
//
// The book travels to the database into a staging table of the transaction
// first, so swapping it in is a copy inside Postgres, never the bytes over the
// owner's link. A rebuild also READS and BUILDS before it takes the lock (R2:
// every studio's add and sign-up seed waits on that lock), and keeps what it
// built only when no bulletin was published or withdrawn meanwhile.
import { MARKET_WRITE_LOCK, SEED_BOOK_VERSION_QUERY, buildSeedBook, type SeedBookEntry } from '@metra/db/market-seed';
import { MIGRATION_LOCK_TIMEOUT } from '@metra/db/lock-timeout';
import type { PostgresJs, Transaction } from '../db/connection';
import { readMarketSeedItems } from './read';

const COLUMNS = `item_id, position, code, name_ar, name_en, name_forms, status, unit, unit_cost, unit_price,
                 leaf_key, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en`;

/** `book` in this transaction's staging table (dropped at commit), replacing what it held. */
async function stageSeedBook(tx: Transaction, book: SeedBookEntry[]): Promise<void> {
  await tx.unsafe(`create temporary table if not exists seed_book_staging on commit drop as
                     select ${COLUMNS} from market_seed_book with no data`);
  await tx`truncate seed_book_staging`;
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
    insert into seed_book_staging (item_id, position, code, name_ar, name_en, name_forms, status, unit, unit_cost, unit_price,
                                   leaf_key, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en)
    select item_id, position, code, name_ar, name_en, name_forms, status, unit, unit_cost, unit_price,
           leaf_key, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en
      from jsonb_to_recordset(${rows}::text::jsonb) as e(item_id uuid, position integer, code text, name_ar text, name_en text,
             name_forms text[], status market_item_status, unit cost_item_unit, unit_cost numeric, unit_price numeric,
             leaf_key text, leaf_name_ar text, leaf_name_en text, top_name_ar text, top_name_en text)`;
}

/** The staged book as THE stored book. The caller holds the market write lock. */
async function swapInStagedBook(tx: Transaction): Promise<void> {
  await tx`delete from market_seed_book`;
  await tx.unsafe(`insert into market_seed_book (${COLUMNS}) select ${COLUMNS} from seed_book_staging`);
}

/** Build the book from what `tx` sees published, and stage it. */
async function buildAndStage(tx: Transaction): Promise<SeedBookEntry[]> {
  const book = buildSeedBook(await readMarketSeedItems(tx));
  await stageSeedBook(tx, book);
  return book;
}

/** Rebuild the stored book from what `tx` sees published, under the caller's market write lock; returns the book it stored. */
export async function refreshSeedBook(tx: Transaction): Promise<SeedBookEntry[]> {
  const book = await buildAndStage(tx);
  await swapInStagedBook(tx);
  return book;
}

/**
 * Every bulletin with its status. Each market write (publish, withdrawal)
 * inserts or withdraws a bulletin in the one transaction that writes the
 * items, categories and observations a book is built from, under the market
 * write lock: the same answer twice means the same book.
 */
async function bulletinsState(tx: Transaction): Promise<string> {
  const [{ state }] = await tx<Array<{ state: string }>>`
    select coalesce(string_agg(id::text || ':' || status::text, ',' order by id), '') as state from market_bulletins`;
  return state;
}

/** The stored book, and the digest a studio's transaction checks it against (@metra/db/market-seed version.ts). */
export interface StoredSeedBook {
  entries: SeedBookEntry[];
  version: string;
}

/**
 * Rebuild the stored book from what is published, in its own transaction,
 * behind any publish or withdrawal in flight (the market write lock,
 * exclusively, for that transaction only). The book is read, built and staged
 * BEFORE the lock; under it, the bulletins are checked unchanged since before
 * that read (else the book is built again, there) and the staged book is
 * swapped in. Nothing is held once it commits: a real
 * `market:seed-price-books` run holds the book per studio instead
 * (holdForSeed), and checks there that it is still this one.
 */
export async function rebuildSeedBook(sql: PostgresJs): Promise<StoredSeedBook> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('lock_timeout', ${MIGRATION_LOCK_TIMEOUT}, true)`;
    const builtFrom = await bulletinsState(tx);
    let entries = await buildAndStage(tx);
    await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
    if ((await bulletinsState(tx)) !== builtFrom) entries = await buildAndStage(tx);
    await swapInStagedBook(tx);
    const [{ version }] = await tx.unsafe<Array<{ version: string }>>(SEED_BOOK_VERSION_QUERY);
    return { entries, version };
  })) as StoredSeedBook;
}
