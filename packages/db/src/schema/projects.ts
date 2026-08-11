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
import { bilingual, bilingualCheck } from './_helpers';
import { clients } from './clients';
import { projectStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Projects (P1 Slice 2). User-entered `code` (unique per org), bilingual name,
 * a same-org client (composite FK is the cross-org backstop), a lifecycle
 * status, optional dates/location, soft-deleted via `active`.
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
    status: projectStatus('status').notNull().default('draft'),
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
    ...sameOrgFk(t, 'client', clients, { onDelete: 'restrict' }),
    index('projects_org_status_idx').on(t.orgId, t.status),
    index('projects_org_active_idx').on(t.orgId, t.active),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
