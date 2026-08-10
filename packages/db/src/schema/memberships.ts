import {
  index,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { memberRole } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * A user's role within an org. `user_id` is the Supabase `auth.users.id`
 * (cross-schema, not a Drizzle FK). One row per (org, user).
 */
export const memberships = pgTable(
  'memberships',
  {
    ...orgScoped(),
    // org_id FK attached here via the deferred thunk (see org-scoped.ts note).
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull(),
    role: memberRole('role').notNull(),
  },
  (t) => [
    unique('memberships_org_id_id_unique').on(t.orgId, t.id),
    unique('memberships_org_user_unique').on(t.orgId, t.userId),
    // Speeds the un-joined `where user_id = $1` lookup in
    // app_current_user_memberships()/app_current_user_orgs().
    index('memberships_user_id_idx').on(t.userId),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
