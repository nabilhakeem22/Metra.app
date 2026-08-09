import { pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { memberRole } from './enums';
import { orgScoped } from './org-scoped';

/**
 * A user's role within an org. `user_id` is the Supabase `auth.users.id`
 * (cross-schema, not a Drizzle FK). One row per (org, user).
 */
export const memberships = pgTable(
  'memberships',
  {
    ...orgScoped(),
    userId: uuid('user_id').notNull(),
    role: memberRole('role').notNull(),
  },
  (t) => [
    unique('memberships_org_id_id_unique').on(t.orgId, t.id),
    unique('memberships_org_user_unique').on(t.orgId, t.userId),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
