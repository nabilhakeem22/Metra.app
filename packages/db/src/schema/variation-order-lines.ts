import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { contractLines } from './contract-lines';
import { costItems } from './cost-items';
import { costItemUnit } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { variationOrders } from './variation-orders';

/**
 * A priced line within a variation order. `contractLineId` (nullable, set-null):
 * NULL = brand-new scope; set = a change measured against a baseline contract
 * line. `lineTotal` carries the delta (a negative qty yields a negative total,
 * i.e. a de-scope). cost/margin caches are SERVER-written; never leak to clients.
 */
export const variationOrderLines = pgTable(
  'variation_order_lines',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    variationOrderId: uuid('variation_order_id').notNull(),
    contractLineId: uuid('contract_line_id'),
    costItemId: uuid('cost_item_id'),
    ...bilingual('description'),
    qty: money('qty').notNull(),
    unit: costItemUnit('unit').notNull(),
    unitCost: money('unit_cost').notNull().default('0'),
    unitPrice: money('unit_price').notNull(),
    discountPct: money('discount_pct').notNull().default('0'),
    lineCost: money('line_cost').notNull().default('0'),
    lineTotal: money('line_total').notNull().default('0'),
    lineMargin: money('line_margin').notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('variation_order_lines_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('variation_order_lines', 'description'),
    check(
      'variation_order_lines_discount_pct_range',
      sql`discount_pct >= 0 and discount_pct <= 100`,
    ),
    ...sameOrgFk(t, 'variationOrder', variationOrders, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'contractLine', contractLines, { onDelete: 'set null' }),
    ...sameOrgFk(t, 'costItem', costItems, { onDelete: 'set null' }),
    index('variation_order_lines_org_vo_sort_idx').on(
      t.orgId,
      t.variationOrderId,
      t.sortOrder,
    ),
  ],
);

export type VariationOrderLine = typeof variationOrderLines.$inferSelect;
export type NewVariationOrderLine = typeof variationOrderLines.$inferInsert;
