import { sql } from 'drizzle-orm';
import { boolean, check, date, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { marketBulletinStatus, marketPublisher } from './enums';

/**
 * Part of the market price book (migration 0061): a PLATFORM-LEVEL, read-only
 * reference dataset of the Ministry of Housing's monthly building-materials
 * guide prices.
 * No `org_id`: every studio reads it (SELECT-only, rls/policies/60-market.sql),
 * and only the owner's `market:publish` CLI writes it, as the BYPASSRLS
 * connection role. Deliberately absent from `orgScopedTables`.
 */
const SHA256 = `'^[0-9a-f]{64}$'`;

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

export type MarketBulletin = typeof marketBulletins.$inferSelect;
