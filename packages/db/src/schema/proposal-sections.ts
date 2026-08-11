import {
  index,
  integer,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { proposals } from './proposals';

/** A titled section of a proposal, carrying a server-written subtotal. */
export const proposalSections = pgTable(
  'proposal_sections',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    proposalId: uuid('proposal_id').notNull(),
    ...bilingual('title'),
    sortOrder: integer('sort_order').notNull().default(0),
    sectionSubtotal: money('section_subtotal').notNull().default('0'),
  },
  (t) => [
    unique('proposal_sections_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('proposal_sections', 'title'),
    ...sameOrgFk(t, 'proposal', proposals, { onDelete: 'cascade' }),
    index('proposal_sections_org_proposal_sort_idx').on(
      t.orgId,
      t.proposalId,
      t.sortOrder,
    ),
  ],
);

export type ProposalSection = typeof proposalSections.$inferSelect;
export type NewProposalSection = typeof proposalSections.$inferInsert;
