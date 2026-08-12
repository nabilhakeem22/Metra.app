import {
  boolean,
  index,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Reusable section-title suggestions (create-on-use). One bilingual name per
 * org, editable by anyone with `proposals_build`. Proposals SNAPSHOT the title
 * into `proposal_sections` — there is intentionally NO FK from a section back
 * to this table, so renaming/deactivating a library entry never rewrites past
 * proposals. `unique(org_id, id)` is the universal composite-FK target.
 */
export const proposalSectionLibrary = pgTable(
  'proposal_section_library',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    ...bilingual('name'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('proposal_section_library_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('proposal_section_library', 'name'),
    index('proposal_section_library_org_active_idx').on(t.orgId, t.active),
  ],
);

export type ProposalSectionLibraryEntry =
  typeof proposalSectionLibrary.$inferSelect;
export type NewProposalSectionLibraryEntry =
  typeof proposalSectionLibrary.$inferInsert;
