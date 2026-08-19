import {
  index,
  integer,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { contracts } from './contracts';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * A titled section of a contract — a frozen snapshot of the source proposal
 * section (no FK back to the proposal section; the contract is a standalone
 * document once generated). Carries a server-written subtotal.
 */
export const contractSections = pgTable(
  'contract_sections',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').notNull(),
    ...bilingual('title'),
    sortOrder: integer('sort_order').notNull().default(0),
    sectionSubtotal: money('section_subtotal').notNull().default('0'),
  },
  (t) => [
    unique('contract_sections_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('contract_sections', 'title'),
    ...sameOrgFk(t, 'contract', contracts, { onDelete: 'cascade' }),
    index('contract_sections_org_contract_sort_idx').on(
      t.orgId,
      t.contractId,
      t.sortOrder,
    ),
  ],
);

export type ContractSection = typeof contractSections.$inferSelect;
export type NewContractSection = typeof contractSections.$inferInsert;
