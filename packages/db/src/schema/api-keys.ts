import {
  index,
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
 * Public API keys (v1). Only the sha256 HASH of the raw key is stored — the raw
 * `mtk_…` key is shown ONCE at mint and never persisted or logged. Org-scoped
 * (RLS). A key carries NO role/visibility of its own: it resolves to its
 * creator's CURRENT membership role (live), and cost/margin visibility is derived
 * per-request from canSeeMargin(role, org.hideMarginFromPm). Revoked by stamping
 * `revoked_at` (never hard-deleted — no DELETE grant to metra_app).
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    // sha256 hex of the raw key; UNIQUE. The raw key is never stored.
    tokenHash: text('token_hash').notNull(),
    // First ~8 chars of the raw key (NOT secret) — for UI disambiguation only.
    tokenPrefix: text('token_prefix').notNull(),
    // The minting member; the live-role principal the key resolves through.
    createdBy: uuid('created_by').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    unique('api_keys_org_id_id_unique').on(t.orgId, t.id),
    unique('api_keys_token_hash_unique').on(t.tokenHash),
    index('api_keys_token_hash_idx').on(t.tokenHash),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
