import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money } from './_helpers';
import { contractLines } from './contract-lines';
import { contractSections } from './contract-sections';
import { contracts } from './contracts';
import { costItems } from './cost-items';
import { costCategory, costItemUnit } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameContractFk, sameOrgFk } from './org-ref';

/**
 * An actual cost (المصروفات) recorded against an execution contract (Stage 2,
 * 0063): materials, labour, a subcontractor... booked to one contract line, one
 * section, or the whole contract (both targets null). A line target always names
 * its section too (`contract_cost_entries_line_needs_section`), and the 3-column
 * FKs make "that line / section belongs to THIS contract" a database fact; the
 * core also checks the line sits in the named section.
 *
 * MUTABLE, NEVER DELETED: editable and voidable (`voided_at` / `voided_by`), so
 * SELECT + INSERT + UPDATE in roles.sql and no DELETE. A voided entry is left
 * out of every total.
 *
 * `qty`, `unit` and `unit_cost` are all set or all null; `amount` is the figure
 * the totals use either way. `cost_item_id` is an optional price-book reference
 * (for the market comparison only), `ON DELETE SET NULL (cost_item_id)` in the
 * database (0063, the 0052 rule).
 */
export const contractCostEntries = pgTable(
  'contract_cost_entries',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').notNull(),
    contractSectionId: uuid('contract_section_id'),
    contractLineId: uuid('contract_line_id'),
    costItemId: uuid('cost_item_id'),
    category: costCategory('category').notNull(),
    description: text('description').notNull(),
    qty: money('qty'),
    unit: costItemUnit('unit'),
    unitCost: money('unit_cost'),
    amount: money('amount').notNull(),
    incurredOn: date('incurred_on').notNull(),
    supplier: text('supplier'),
    reference: text('reference'),
    recordedBy: uuid('recorded_by').notNull(),
    idempotencyKey: text('idempotency_key'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
  },
  (t) => [
    unique('contract_cost_entries_org_id_id_unique').on(t.orgId, t.id),
    // Present = at least one character that is not whitespace: ASCII space,
    // tab and newline ([[:space:]]) and the Unicode spaces a paste brings
    // (no-break, the U+2000 block, zero-width, line and paragraph separators,
    // narrow no-break, ideographic, BOM). btrim() strips only ' '.
    check(
      'contract_cost_entries_description_present',
      sql`description ~ '[^[:space:]\\u00a0\\u1680\\u2000-\\u200b\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]' and char_length(description) <= 300`,
    ),
    check('contract_cost_entries_amount_positive', sql`amount > 0 and amount <> 'NaN'`),
    check('contract_cost_entries_qty_positive', sql`qty > 0 and qty <> 'NaN'`),
    check('contract_cost_entries_unit_cost_nonneg', sql`unit_cost >= 0 and unit_cost <> 'NaN'`),
    check(
      'contract_cost_entries_quantity_triple',
      sql`(qty is null) = (unit is null) and (unit is null) = (unit_cost is null)`,
    ),
    check(
      'contract_cost_entries_line_needs_section',
      sql`contract_line_id is null or contract_section_id is not null`,
    ),
    check(
      'contract_cost_entries_text_length',
      sql`char_length(supplier) <= 120 and char_length(reference) <= 120`,
    ),
    check(
      'contract_cost_entries_void_pair',
      sql`(voided_at is null) = (voided_by is null)`,
    ),
    // `index: false`: the list index below leads with the same two columns.
    ...sameOrgFk(t, 'contract', contracts, { onDelete: 'restrict', index: false }),
    sameContractFk(t, 'contractSection', contractSections),
    sameContractFk(t, 'contractLine', contractLines),
    ...sameOrgFk(t, 'costItem', costItems, { onDelete: 'set null' }),
    // The costs tab, newest first (keyset on incurred_on desc, id desc).
    index('contract_cost_entries_org_contract_incurred_idx').on(
      t.orgId,
      t.contractId,
      t.incurredOn.desc(),
      t.id.desc(),
    ),
    index('contract_cost_entries_org_line_idx')
      .on(t.orgId, t.contractLineId)
      .where(sql`contract_line_id is not null`),
    uniqueIndex('contract_cost_entries_idempotency_key_uniq')
      .on(t.orgId, t.contractId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ],
);

export type ContractCostEntry = typeof contractCostEntries.$inferSelect;
export type NewContractCostEntry = typeof contractCostEntries.$inferInsert;
