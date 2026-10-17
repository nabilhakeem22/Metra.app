import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { marketBulletins } from './market-bulletins';
import { marketItems } from './market-items';

/**
 * Part of the market price book (migration 0061): an item's printed details
 * (names, spec, unit label, basis note) AS EACH BULLETIN PRINTED THEM. The
 * columns on `market_items` are a copy of the newest PUBLISHED bulletin's row
 * here: `market:publish` and `market:withdraw` re-derive them, so a corrected
 * `--replace` corrects what studios see and a withdrawal restores the previous
 * bulletin's wording. Kept per bulletin, so the history is never overwritten.
 * Platform-level, SELECT-only (rls/policies/60-market.sql).
 */
export const marketItemDetails = pgTable(
  'market_item_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references((): AnyPgColumn => marketItems.id, { onDelete: 'restrict' }),
    bulletinId: uuid('bulletin_id')
      .notNull()
      .references((): AnyPgColumn => marketBulletins.id, { onDelete: 'restrict' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    specAr: text('spec_ar'),
    specEn: text('spec_en'),
    unitLabelAr: text('unit_label_ar').notNull(),
    basisNoteAr: text('basis_note_ar'),
  },
  (t) => [
    unique('market_item_details_item_bulletin_unique').on(t.itemId, t.bulletinId),
    check('market_item_details_names_present', sql`btrim(${t.nameAr}) <> '' and btrim(${t.nameEn}) <> ''`),
    index('market_item_details_bulletin_idx').on(t.bulletinId),
  ],
);

export type MarketItemDetail = typeof marketItemDetails.$inferSelect;
