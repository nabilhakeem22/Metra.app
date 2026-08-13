import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { stageStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projects } from './projects';

/**
 * Per-project stages, seeded from the org's stage_templates on project create,
 * then fully editable (add/remove/reorder, status, progress) — so a project can
 * START AT ANY PHASE (mark earlier stages done/skipped). The "current" stage is
 * DERIVED (the in_progress one, else the first non-done/non-skipped by sort),
 * NOT a stored column. Cascades from its project.
 */
export const projectStages = pgTable(
  'project_stages',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').notNull(),
    // Stable machine key copied from the template (design_drawings/…); NULL for
    // ad-hoc stages a user adds to a single project.
    stageKey: text('stage_key'),
    ...bilingual('name'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: stageStatus('status').notNull().default('not_started'),
    progressPct: money('progress_pct').notNull().default('0'),
    startDate: date('start_date'),
    endDate: date('end_date'),
  },
  (t) => [
    unique('project_stages_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('project_stages', 'name'),
    check(
      'project_stages_progress_range',
      sql`progress_pct >= 0 and progress_pct <= 100`,
    ),
    check(
      'project_stages_date_order',
      sql`end_date is null or start_date is null or end_date >= start_date`,
    ),
    ...sameOrgFk(t, 'project', projects, { onDelete: 'cascade' }),
    index('project_stages_org_project_sort_idx').on(
      t.orgId,
      t.projectId,
      t.sortOrder,
    ),
  ],
);

export type ProjectStage = typeof projectStages.$inferSelect;
export type NewProjectStage = typeof projectStages.$inferInsert;
