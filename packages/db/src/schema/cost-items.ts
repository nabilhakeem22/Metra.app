import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { costItemCategory, costItemUnit } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Price Book cost items (P1 Slice 1). One catalogue row per org: a code, a
 * bilingual name, a category + unit, and default cost/price in EGP money().
 * `unique(org_id, id)` is the universal composite-FK target; `unique(org_id,
 * code)` makes code the human key within an org (import is insert-only on it).
 */
export const costItems = pgTable(
  'cost_items',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    ...bilingual('name'),
    category: costItemCategory('category').notNull(),
    unit: costItemUnit('unit').notNull(),
    defaultUnitCost: money('default_unit_cost').notNull().default('0'),
    defaultUnitPrice: money('default_unit_price').notNull().default('0'),
    taxCode: text('tax_code'),
    etaItemCode: text('eta_item_code'),
    etaCodeType: text('eta_code_type'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('cost_items_org_id_id_unique').on(t.orgId, t.id),
    unique('cost_items_org_id_code_unique').on(t.orgId, t.code),
    bilingualCheck('cost_items', 'name'),
    check('cost_items_default_unit_cost_nonneg', sql`${t.defaultUnitCost} >= 0`),
    check(
      'cost_items_default_unit_price_nonneg',
      sql`${t.defaultUnitPrice} >= 0`,
    ),
    index('cost_items_org_category_idx').on(t.orgId, t.category),
    index('cost_items_org_active_idx').on(t.orgId, t.active),
  ],
);

export type CostItem = typeof costItems.$inferSelect;
export type NewCostItem = typeof costItems.$inferInsert;
