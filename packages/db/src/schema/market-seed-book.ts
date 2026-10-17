import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { money } from './_helpers';
import { costItemUnit, marketItemStatus } from './enums';
import { marketItems } from './market-items';

/**
 * The seed book (migration 0062): every published market item AS A STUDIO'S
 * PRICE BOOK WOULD RECEIVE IT, built by the one seed implementation
 * (src/market-seed/book.ts) over the whole published set. A DERIVED copy of
 * the market tables: `market:publish`, `market:withdraw` and
 * `market:seed-price-books` rebuild it whole, in their own transaction, so it
 * always says what the published book says. It exists so the app can seed a
 * studio (a new one at sign-up, an empty book's button) inside a Worker's CPU
 * budget: the names and prices are already decided here, and one studio's plan
 * is set lookups. Platform-level, SELECT-only for metra_app
 * (rls/policies/60-market.sql); deliberately absent from `orgScopedTables`.
 */
export const marketSeedBook = pgTable(
  'market_seed_book',
  {
    itemId: uuid('item_id')
      .primaryKey()
      .references((): AnyPgColumn => marketItems.id, { onDelete: 'cascade' }),
    /** The display order the seed walks the book in (it decides section and name order). */
    position: integer('position').notNull(),
    code: text('code').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    /** The comparison forms a studio's own item clashes with. */
    nameForms: text('name_forms').array().notNull(),
    status: marketItemStatus('status').notNull(),
    /** The studio unit; null when none fits (the item is never seeded). */
    unit: costItemUnit('unit'),
    /** Cost and selling price (cost x 1.05); null when no month has a numeric price. */
    unitCost: money('unit_cost'),
    unitPrice: money('unit_price'),
    leafKey: text('leaf_key').notNull(),
    leafNameAr: text('leaf_name_ar').notNull(),
    leafNameEn: text('leaf_name_en').notNull(),
    topNameAr: text('top_name_ar').notNull(),
    topNameEn: text('top_name_en').notNull(),
    builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('market_seed_book_position_unique').on(t.position),
    unique('market_seed_book_code_unique').on(t.code),
    check('market_seed_book_code_format', sql`${t.code} like 'MKT-%'`),
    check('market_seed_book_names_present', sql`btrim(${t.nameAr}) <> '' and btrim(${t.nameEn}) <> ''`),
    check(
      'market_seed_book_prices',
      sql`(${t.unitCost} is null) = (${t.unitPrice} is null) and coalesce(${t.unitCost}, 0) >= 0 and coalesce(${t.unitPrice}, 0) >= 0`,
    ),
  ],
);

export type MarketSeedBookRow = typeof marketSeedBook.$inferSelect;
