import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projects } from './projects';

/**
 * Who works on which project's site (Stage 3, 0064). The site app lists ONLY
 * the caller's live assignments, and a site engineer may write diary rows only
 * on a project he is assigned to: the core checks it, and the RESTRICTIVE insert
 * policy `site_write_assigned` (rls/policies/70-site.sql) checks it again
 * through `app_may_write_site_project`.
 *
 * NEVER DELETED: an assignment ends by stamping `revoked_at` / `revoked_by`
 * (SELECT + INSERT + UPDATE in roles.sql, no DELETE), so the history of who was
 * on a site stays. One LIVE row per (project, user): a re-assignment after a
 * revoke is a new row.
 */
export const projectAssignments = pgTable(
  'project_assignments',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id').notNull(),
    assignedBy: uuid('assigned_by').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
  },
  (t) => [
    unique('project_assignments_org_id_id_unique').on(t.orgId, t.id),
    check(
      'project_assignments_revoke_pair',
      sql`(revoked_at is null) = (revoked_by is null)`,
    ),
    ...sameOrgFk(t, 'project', projects, { onDelete: 'restrict' }),
    uniqueIndex('project_assignments_one_live')
      .on(t.orgId, t.projectId, t.userId)
      .where(sql`revoked_at is null`),
    // The app's project list: one engineer's live assignments.
    index('project_assignments_org_user_live_idx')
      .on(t.orgId, t.userId)
      .where(sql`revoked_at is null`),
  ],
);

export type ProjectAssignment = typeof projectAssignments.$inferSelect;
export type NewProjectAssignment = typeof projectAssignments.$inferInsert;
