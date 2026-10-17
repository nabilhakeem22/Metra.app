import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { money } from './_helpers';
import { marketObservationStatus } from './enums';
import { marketBulletins } from './market-bulletins';
import { marketItems } from './market-items';

/**
 * Part of the market price book (migration 0061): a PLATFORM-LEVEL, read-only
 * reference dataset of the Ministry of Housing's monthly building-materials
 * guide prices.
 * No `org_id`: every studio reads it (SELECT-only, rls/policies/60-market.sql),
 * and only the owner's `market:publish` CLI writes it, as the BYPASSRLS
 * connection role. Deliberately absent from `orgScopedTables`.
 */
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

export type MarketPriceObservation = typeof marketPriceObservations.$inferSelect;
