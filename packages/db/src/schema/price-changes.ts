import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money } from './_helpers';
import { costItems } from './cost-items';
import { costItemCategory } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Append-only price-change history header (A2 — first-class, NOT audit_log). One
 * row per bulk `+X%` application: which category, the percentage, what it hit
 * (cost/price/both), when it takes effect (metadata), who applied it, and how
 * many items moved. metra_app has SELECT+INSERT only (no UPDATE/DELETE grant).
 */
export const priceChanges = pgTable(
  'price_changes',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    category: costItemCategory('category').notNull(),
    pctChange: numeric('pct_change', { precision: 9, scale: 4 }).notNull(),
    // 'cost' | 'price' | 'both'
    target: text('target').notNull(),
    effectiveDate: date('effective_date').notNull(),
    appliedBy: uuid('applied_by').notNull(),
    itemCount: integer('item_count').notNull(),
  },
  (t) => [unique('price_changes_org_id_id_unique').on(t.orgId, t.id)],
);

/**
 * Append-only per-item line for a price change: the before/after cost & price of
 * each cost item the bulk update touched. Composite same-org FKs make a
 * cross-org reference impossible at the DB. Cascades from its header; restricts
 * its cost item (history pins the item).
 */
export const priceChangeLines = pgTable(
  'price_change_lines',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    priceChangeId: uuid('price_change_id').notNull(),
    costItemId: uuid('cost_item_id').notNull(),
    oldUnitCost: money('old_unit_cost').notNull(),
    newUnitCost: money('new_unit_cost').notNull(),
    oldUnitPrice: money('old_unit_price').notNull(),
    newUnitPrice: money('new_unit_price').notNull(),
  },
  (t) => [
    unique('price_change_lines_org_id_id_unique').on(t.orgId, t.id),
    ...sameOrgFk(t, 'priceChange', priceChanges, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'costItem', costItems, { onDelete: 'restrict' }),
  ],
);

export type PriceChange = typeof priceChanges.$inferSelect;
export type NewPriceChange = typeof priceChanges.$inferInsert;
export type PriceChangeLine = typeof priceChangeLines.$inferSelect;
export type NewPriceChangeLine = typeof priceChangeLines.$inferInsert;
