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
 * One org-wide, editable stage process (the default 10-stage fit-out sequence,
 * seeded per org). A new project copies these into its own `project_stages`, so
 * editing the template never rewrites live projects. Mirrors `sections`.
 */
export const stageTemplates = pgTable(
  'stage_templates',
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
    unique('stage_templates_org_id_id_unique').on(t.orgId, t.id),
    uniqueIndex('stage_templates_org_key_unique')
      .on(t.orgId, t.key)
      .where(sql`${t.key} is not null`),
    bilingualCheck('stage_templates', 'name'),
    index('stage_templates_org_sort_idx').on(t.orgId, t.sortOrder),
  ],
);

export type StageTemplate = typeof stageTemplates.$inferSelect;
export type NewStageTemplate = typeof stageTemplates.$inferInsert;
