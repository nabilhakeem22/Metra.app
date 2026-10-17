import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money, timestamps } from './_helpers';
import {
  marketBulletinStatus,
  marketItemStatus,
  marketObservationStatus,
  marketPublisher,
  marketUnit,
} from './enums';

/**
 * The market price book (migration 0061): a PLATFORM-LEVEL, read-only reference
 * dataset of the Ministry of Housing's monthly building-materials guide prices.
 * No `org_id`: every studio reads it (SELECT-only, rls/policies/60-market.sql),
 * and only the owner's `market:publish` CLI writes it, as the BYPASSRLS
 * connection role. Deliberately absent from `orgScopedTables`.
 */
const SHA256 = `'^[0-9a-f]{64}$'`;

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

export const marketBulletins = pgTable(
  'market_bulletins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publisher: marketPublisher('publisher').notNull(),
    periodMonth: date('period_month', { mode: 'string' }).notNull(),
    status: marketBulletinStatus('status').notNull(),
    sourcePdfFileName: text('source_pdf_file_name'),
    sourcePdfSha256: text('source_pdf_sha256'),
    sourceMdFileName: text('source_md_file_name'),
    sourceMdSha256: text('source_md_sha256'),
    sourcePageCount: integer('source_page_count').notNull(),
    regionKey: text('region_key').notNull().default('greater_cairo'),
    collectionFromDay: smallint('collection_from_day').notNull().default(14),
    collectionToDay: smallint('collection_to_day').notNull().default(16),
    includesTaxes: boolean('includes_taxes').notNull().default(true),
    includesTransport: boolean('includes_transport').notNull().default(false),
    publishedOn: date('published_on', { mode: 'string' }),
    extractionMethod: text('extraction_method').notNull(),
    extractionSha256: text('extraction_sha256').notNull(),
    reviewedBy: text('reviewed_by').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnReason: text('withdrawn_reason'),
  },
  (t) => [
    check('market_bulletins_period_first_day', sql`extract(day from ${t.periodMonth}) = 1`),
    check('market_bulletins_pdf_sha256_format', sql.raw(`source_pdf_sha256 ~ ${SHA256}`)),
    check('market_bulletins_md_sha256_format', sql.raw(`source_md_sha256 ~ ${SHA256}`)),
    check('market_bulletins_extraction_sha256_format', sql.raw(`extraction_sha256 ~ ${SHA256}`)),
    check('market_bulletins_pdf_named', sql`(${t.sourcePdfFileName} is null) = (${t.sourcePdfSha256} is null)`),
    check('market_bulletins_md_named', sql`(${t.sourceMdFileName} is null) = (${t.sourceMdSha256} is null)`),
    check(
      'market_bulletins_extraction_method',
      sql`(${t.extractionMethod} = 'session:pdf' and ${t.sourcePdfSha256} is not null) or (${t.extractionMethod} = 'session:md' and ${t.sourceMdSha256} is not null)`,
    ),
    check('market_bulletins_page_count_positive', sql`${t.sourcePageCount} > 0`),
    check(
      'market_bulletins_collection_days',
      sql`1 <= ${t.collectionFromDay} and ${t.collectionFromDay} <= ${t.collectionToDay} and ${t.collectionToDay} <= 31`,
    ),
    check('market_bulletins_reviewer_present', sql`btrim(${t.reviewedBy}) <> ''`),
    check(
      'market_bulletins_withdrawn_iff_reason',
      sql`(${t.status} = 'withdrawn') = (${t.withdrawnAt} is not null and ${t.withdrawnReason} is not null)`,
    ),
    uniqueIndex('market_bulletins_one_published_per_period')
      .on(t.publisher, t.periodMonth)
      .where(sql`${t.status} = 'published'`),
  ],
);

export const marketPriceObservations = pgTable(
  'market_price_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references((): AnyPgColumn => marketItems.id, { onDelete: 'restrict' }),
    bulletinId: uuid('bulletin_id')
      .notNull()
      .references((): AnyPgColumn => marketBulletins.id, { onDelete: 'restrict' }),
    periodMonth: date('period_month', { mode: 'string' }).notNull(),
    status: marketObservationStatus('status').notNull(),
    price: money('price'),
    sourcePdfPage: integer('source_pdf_page'),
    sourcePrintedPage: integer('source_printed_page'),
  },
  (t) => [
    unique('market_price_observations_item_month_bulletin_unique').on(t.itemId, t.periodMonth, t.bulletinId),
    check('market_price_observations_period_first_day', sql`extract(day from ${t.periodMonth}) = 1`),
    check('market_price_observations_priced_iff_price', sql`(${t.status} = 'priced') = (${t.price} is not null)`),
    check('market_price_observations_price_positive', sql`${t.price} > 0`),
    check(
      'market_price_observations_source_page',
      sql`(${t.sourcePdfPage} is not null or ${t.sourcePrintedPage} is not null) and coalesce(${t.sourcePdfPage}, 1) > 0 and coalesce(${t.sourcePrintedPage}, 1) > 0`,
    ),
    index('market_price_observations_item_month_idx').on(t.itemId, t.periodMonth.desc()),
    index('market_price_observations_bulletin_idx').on(t.bulletinId),
  ],
);

export type MarketCategory = typeof marketCategories.$inferSelect;
export type MarketItem = typeof marketItems.$inferSelect;
export type MarketBulletin = typeof marketBulletins.$inferSelect;
export type MarketPriceObservation = typeof marketPriceObservations.$inferSelect;
