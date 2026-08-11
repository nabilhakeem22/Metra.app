import {
  index,
  integer,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { costItems } from './cost-items';
import { costItemUnit } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { proposalSections } from './proposal-sections';
import { proposals } from './proposals';

/**
 * A priced line within a proposal section. `costItemId` (nullable) links the
 * price-book source; cost/margin caches are SERVER-written and must never leak to
 * a client who can't see margin.
 */
export const proposalLines = pgTable(
  'proposal_lines',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    // Denormalized parent proposal (kept for org-scoped queries + cascade).
    proposalId: uuid('proposal_id').notNull(),
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
    unique('proposal_lines_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('proposal_lines', 'description'),
    ...sameOrgFk(t, 'proposal', proposals, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'section', proposalSections, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'costItem', costItems, { onDelete: 'set null' }),
    index('proposal_lines_org_section_sort_idx').on(
      t.orgId,
      t.sectionId,
      t.sortOrder,
    ),
  ],
);

export type ProposalLine = typeof proposalLines.$inferSelect;
export type NewProposalLine = typeof proposalLines.$inferInsert;
