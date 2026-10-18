import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { contracts } from './contracts';
import { milestoneBasis } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * An execution contract's payment schedule (Stage 2, 0063): the TERMS the client
 * signs, e.g. 50 / 30 / 20. Edited while the contract is `draft` (full DML in
 * roles.sql) and frozen once it is issued by the existing
 * `enforce_contract_child_draft()` trigger (MT100), exactly like the contract's
 * own lines.
 *
 * `basis` decides how `value` reads: `percent` (the rows sum to exactly
 * 100.0000) or `amount` (the rows sum to `contracts.original_value`). One basis
 * per schedule, 1 to 12 rows; the core validates both (lib/execution/money).
 * A milestone's AMOUNT is never stored: it is derived from `original_value`,
 * the last row taking the rounding remainder. Cascade delete follows the
 * contract (possible only while it is a draft).
 */
export const contractPaymentMilestones = pgTable(
  'contract_payment_milestones',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').notNull(),
    ...bilingual('label'),
    basis: milestoneBasis('basis').notNull(),
    value: money('value').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    unique('contract_payment_milestones_org_id_id_unique').on(t.orgId, t.id),
    // Also the index of the contract FK below, hence its `index: false`.
    unique('contract_payment_milestones_org_contract_sort_unique').on(
      t.orgId,
      t.contractId,
      t.sortOrder,
    ),
    bilingualCheck('contract_payment_milestones', 'label'),
    check(
      'contract_payment_milestones_label_length',
      sql`coalesce(char_length(label_ar), 0) <= 80 and coalesce(char_length(label_en), 0) <= 80`,
    ),
    check('contract_payment_milestones_value_positive', sql`value > 0`),
    ...sameOrgFk(t, 'contract', contracts, { onDelete: 'cascade', index: false }),
  ],
);

export type ContractPaymentMilestone = typeof contractPaymentMilestones.$inferSelect;
export type NewContractPaymentMilestone = typeof contractPaymentMilestones.$inferInsert;
