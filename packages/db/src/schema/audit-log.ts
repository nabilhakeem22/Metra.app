import { jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { auditAction } from './enums';
import { orgScoped } from './org-scoped';

/**
 * §4.4 immutable audit trail. The app role (`metra_app`) is granted
 * SELECT + INSERT only — updates/deletes are rejected at the DB, not just here.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    ...orgScoped(),
    actorUserId: uuid('actor_user_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    action: auditAction('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  (t) => [unique('audit_log_org_id_id_unique').on(t.orgId, t.id)],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
