import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { clients } from './clients';
import { projectStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projectTypes } from './project-types';

/**
 * Projects (P1 Slice 2 + Slice 5 profile). User-entered `code` (unique per org),
 * bilingual name, a same-org client, a nullable `type_id` referencing editable
 * project_types (set null on type delete), advance/retention %, an optional
 * description, a lifecycle status, dates/location, soft-deleted.
 */
export const projects = pgTable(
  'projects',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    ...bilingual('name'),
    clientId: uuid('client_id').notNull(),
    typeId: uuid('type_id'),
    status: projectStatus('status').notNull().default('draft'),
    description: text('description'),
    advancePct: money('advance_pct').notNull().default('0'),
    retentionPct: money('retention_pct').notNull().default('0'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    city: text('city'),
    address: text('address'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('projects_org_id_id_unique').on(t.orgId, t.id),
    unique('projects_org_id_code_unique').on(t.orgId, t.code),
    bilingualCheck('projects', 'name'),
    check(
      'projects_date_order',
      sql`end_date is null or start_date is null or end_date >= start_date`,
    ),
    check('projects_advance_pct_range', sql`advance_pct >= 0 and advance_pct <= 100`),
    check(
      'projects_retention_pct_range',
      sql`retention_pct >= 0 and retention_pct <= 100`,
    ),
    ...sameOrgFk(t, 'client', clients, { onDelete: 'restrict' }),
    // Nullable type reference (set null when a type is deleted).
    ...sameOrgFk(t, 'type', projectTypes, { onDelete: 'set null' }),
    index('projects_org_status_idx').on(t.orgId, t.status),
    index('projects_org_active_idx').on(t.orgId, t.active),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
