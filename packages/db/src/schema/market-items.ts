import { sql } from 'drizzle-orm';
import { check, index, integer, numeric, pgTable, text, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { timestamps } from './_helpers';
import { marketItemStatus, marketUnit } from './enums';
import { marketCategories } from './market-categories';

/**
 * Part of the market price book (migration 0061): a PLATFORM-LEVEL, read-only
 * reference dataset of the Ministry of Housing's monthly building-materials
 * guide prices.
 * No `org_id`: every studio reads it (SELECT-only, rls/policies/60-market.sql),
 * and only the owner's `market:publish` CLI writes it, as the BYPASSRLS
 * connection role. Deliberately absent from `orgScopedTables`.
 */
export const marketItems = pgTable(
  'market_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references((): AnyPgColumn => marketCategories.id, { onDelete: 'restrict' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    specAr: text('spec_ar'),
    specEn: text('spec_en'),
    unit: marketUnit('unit').notNull(),
    unitLabelAr: text('unit_label_ar').notNull(),
    /** A roll's pack (part of the item's identity): one length, or pieces x piece length. */
    packLengthM: numeric('pack_length_m', { precision: 10, scale: 3 }),
    packPieces: integer('pack_pieces'),
    packPieceLengthM: numeric('pack_piece_length_m', { precision: 10, scale: 3 }),
    basisNoteAr: text('basis_note_ar'),
    sourceLabels: text('source_labels').array().notNull().default(sql`'{}'::text[]`),
    status: marketItemStatus('status').notNull().default('active'),
    ...timestamps(),
  },
  (t) => [
    unique('market_items_key_unique').on(t.key),
    check('market_items_key_format', sql`${t.key} ~ '^[a-z0-9_]+(\\.[a-z0-9_]+){2,}$'`),
    check('market_items_names_present', sql`btrim(${t.nameAr}) <> '' and btrim(${t.nameEn}) <> ''`),
    // `unit::text`: 0061 also ADDs a 'roll' label to cost_item_unit, and a label
    // added in the migrator's transaction is never named again as an enum value
    // (migration-enum-values.test.ts); a text comparison is not such a use.
    check(
      'market_items_pack_iff_roll',
      sql`(${t.unit}::text = 'roll') = (${t.packLengthM} is not null or ${t.packPieces} is not null)`,
    ),
    check(
      'market_items_pack_shape',
      sql`(${t.packLengthM} is not null and ${t.packLengthM} > 0 and ${t.packPieces} is null and ${t.packPieceLengthM} is null) or (${t.packLengthM} is null and (${t.packPieces} is null) = (${t.packPieceLengthM} is null) and coalesce(${t.packPieces}, 1) > 0 and coalesce(${t.packPieceLengthM}, 1) > 0)`,
    ),
    index('market_items_category_idx').on(t.categoryId),
  ],
);

export type MarketItem = typeof marketItems.$inferSelect;
