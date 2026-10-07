import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * In-app notifications (P1 Automation). Delivered to a single recipient user;
 * `entity_type`/`entity_id` are polymorphic (NO FK) so a notification can point
 * at a proposal/project/etc. `body_key` + `params` localize at render time
 * (never store rendered copy). RLS is recipient-scoped: a user sees only their
 * own rows (the runner-as-owner may INSERT for any recipient via WITH CHECK).
 */
export const notifications = pgTable(
  'notifications',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    recipientUserId: uuid('recipient_user_id').notNull(),
    kind: text('kind').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    bodyKey: text('body_key').notNull(),
    params: jsonb('params').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    unique('notifications_org_id_id_unique').on(t.orgId, t.id),
    index('notifications_org_recipient_read_idx').on(
      t.orgId,
      t.recipientUserId,
      t.readAt,
    ),
    // Live since 0057: the bell and the feed read a recipient's NEWEST rows
    // (order by created_at desc, limit n). The read index above serves the
    // unread count; without this one every feed load sorted all of a
    // recipient's notifications.
    index('notifications_org_recipient_created_idx').on(
      t.orgId,
      t.recipientUserId,
      t.createdAt.desc().nullsFirst(),
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
