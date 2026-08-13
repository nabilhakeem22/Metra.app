import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
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
 * Per-tenant project classifications (villa/apartment/office/…), EDITABLE data
 * (not an enum) — mirrors `sections`. `key` is set only on the seeded defaults
 * (user-created rows have key=NULL). Projects reference one via a nullable
 * type_id (onDelete set null); there is intentionally NO snapshot needed since
 * the type is a live reference. Tenant-isolated (FORCE RLS via apply-rls).
 */
export const projectTypes = pgTable(
  'project_types',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    key: text('key'),
    ...bilingual('name'),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('project_types_org_id_id_unique').on(t.orgId, t.id),
    uniqueIndex('project_types_org_key_unique')
      .on(t.orgId, t.key)
      .where(sql`${t.key} is not null`),
    bilingualCheck('project_types', 'name'),
    index('project_types_org_active_idx').on(t.orgId, t.active),
  ],
);

export type ProjectType = typeof projectTypes.$inferSelect;
export type NewProjectType = typeof projectTypes.$inferInsert;
