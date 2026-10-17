import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Part of the market price book (migration 0061): a PLATFORM-LEVEL, read-only
 * reference dataset of the Ministry of Housing's monthly building-materials
 * guide prices.
 * No `org_id`: every studio reads it (SELECT-only, rls/policies/60-market.sql),
 * and only the owner's `market:publish` CLI writes it, as the BYPASSRLS
 * connection role. Deliberately absent from `orgScopedTables`.
 */
export const marketCategories = pgTable(
  'market_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => marketCategories.id, {
      onDelete: 'restrict',
    }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('market_categories_key_unique').on(t.key),
    check('market_categories_key_format', sql`${t.key} ~ '^[a-z_]+(\\.[a-z_]+)?$'`),
    check('market_categories_parent_iff_leaf', sql`(${t.parentId} is null) = (strpos(${t.key}, '.') = 0)`),
    check('market_categories_names_present', sql`btrim(${t.nameAr}) <> '' and btrim(${t.nameEn}) <> ''`),
    index('market_categories_parent_idx').on(t.parentId),
  ],
);

export type MarketCategory = typeof marketCategories.$inferSelect;
