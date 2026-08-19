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
import { contractSections } from './contract-sections';
import { contracts } from './contracts';
import { costItems } from './cost-items';
import { costItemUnit } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * A frozen baseline line within a contract section — deep-copied from the source
 * proposal line at generation. `costItemId` (nullable, set-null) is only a
 * snapshot of the price-book source; cost/margin caches are SERVER-written and
 * must never leak to a client surface.
 */
export const contractLines = pgTable(
  'contract_lines',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    // Denormalized parent contract (drives the child-draft guard + org queries).
    contractId: uuid('contract_id').notNull(),
    sectionId: uuid('section_id').notNull(),
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
    unique('contract_lines_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('contract_lines', 'description'),
    check(
      'contract_lines_discount_pct_range',
      sql`discount_pct >= 0 and discount_pct <= 100`,
    ),
    ...sameOrgFk(t, 'contract', contracts, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'section', contractSections, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'costItem', costItems, { onDelete: 'set null' }),
    index('contract_lines_org_section_sort_idx').on(
      t.orgId,
      t.sectionId,
      t.sortOrder,
    ),
  ],
);

export type ContractLine = typeof contractLines.$inferSelect;
export type NewContractLine = typeof contractLines.$inferInsert;
