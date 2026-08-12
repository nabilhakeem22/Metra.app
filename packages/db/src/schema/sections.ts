import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Per-tenant work sections — the single source shared by the Price Book and the
 * proposal builder (replaces the cost_item_category enum AND the old
 * proposal_section_library table). `key` is set only on the 8 seeded defaults
 * (create-on-use rows have key=NULL). Proposals SNAPSHOT the title into
 * proposal_sections; there is intentionally NO FK back here, so renaming or
 * deactivating a section never rewrites past proposals. Tenant-isolated
 * (FORCE RLS): a section one org adds is never visible to another.
 */
export const sections = pgTable(
  'sections',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    // Stable machine key for the seeded defaults (civil/gypsum/…); NULL for
    // user-created sections. Old cost-item categories backfill against this.
    key: text('key'),
    ...bilingual('name'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('sections_org_id_id_unique').on(t.orgId, t.id),
    // One row per (org, key) but only where key is present.
    uniqueIndex('sections_org_key_unique')
      .on(t.orgId, t.key)
      .where(sql`${t.key} is not null`),
    bilingualCheck('sections', 'name'),
    index('sections_org_active_idx').on(t.orgId, t.active),
  ],
);

export type Section = typeof sections.$inferSelect;
export type NewSection = typeof sections.$inferInsert;
