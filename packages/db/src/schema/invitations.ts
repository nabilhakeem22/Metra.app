import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { invitationStatus, memberRole } from './enums';
import { orgScoped } from './org-scoped';

/**
 * Pending/accepted team invitations. Only the sha256 token HASH is stored — the
 * raw token lives only in the emailed/copyable accept link. Org-scoped (RLS).
 */
export const invitations = pgTable(
  'invitations',
  {
    ...orgScoped(),
    // Stored lowercased by the action layer.
    email: text('email').notNull(),
    role: memberRole('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    invitedBy: uuid('invited_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedBy: uuid('accepted_by'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [
    unique('invitations_org_id_id_unique').on(t.orgId, t.id),
    unique('invitations_token_hash_unique').on(t.tokenHash),
    // At most one live pending invite per (org, email).
    index('invitations_org_email_pending_idx')
      .on(t.orgId, t.email)
      .where(sql`status = 'pending'`),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
