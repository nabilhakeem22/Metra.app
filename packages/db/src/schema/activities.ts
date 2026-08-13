import {
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { activityEntityType, activityKind } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Polymorphic activity feed (P1 Slice 4). `entity_type`/`entity_id` point at a
 * client (now) or project (provisioned, wired next slice) — deliberately NO
 * composite FK, since the subject is polymorphic; the core validates the parent
 * is in-org before writing. `kind='note'` carries a user note; the rest are
 * system events. RLS: org-isolated + FORCE.
 */
export const activities = pgTable(
  'activities',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    entityType: activityEntityType('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    kind: activityKind('kind').notNull().default('note'),
    note: text('note'),
    meta: jsonb('meta'),
  },
  (t) => [
    unique('activities_org_id_id_unique').on(t.orgId, t.id),
    index('activities_org_entity_idx').on(
      t.orgId,
      t.entityType,
      t.entityId,
      t.createdAt,
    ),
  ],
);

export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
