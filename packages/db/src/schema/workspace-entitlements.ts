import { sql } from 'drizzle-orm';
import {
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Per-workspace entitlements (Epic A2). Exactly ONE row per workspace
 * (`organizations` = the tenancy boundary), 1:1 via unique(org_id). The
 * subscription plan resolves — PER WORKSPACE — which guided flows are turned on
 * (`enabled_flows`, e.g. `interior`), plus numeric `limits` and boolean
 * `features`. `canUseFlow` reads this row to gate `mutateInOrg`. Mutable
 * (a plan change edits the row), so it lives outside the append-only ledgers.
 *
 * BOOTSTRAP ORDERING (load-bearing): the row's `org_isolation` WITH CHECK calls
 * app_is_current_org_member(), which is FALSE until the owner membership exists.
 * So both createOrg and the seed MUST insert this row AFTER the owner membership,
 * and NEVER via `INSERT ... ON CONFLICT DO UPDATE` (the UPDATE arm pulls in the
 * policy USING → membership → RLS rejection during bootstrap).
 */
export const workspaceEntitlements = pgTable(
  'workspace_entitlements',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    enabledFlows: text('enabled_flows')
      .array()
      .notNull()
      .default(sql`'{}'`),
    limits: jsonb('limits')
      .notNull()
      .default(sql`'{}'::jsonb`),
    features: jsonb('features')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    unique('workspace_entitlements_org_id_unique').on(t.orgId),
    unique('workspace_entitlements_org_id_id_unique').on(t.orgId, t.id),
  ],
);

export type WorkspaceEntitlement = typeof workspaceEntitlements.$inferSelect;
export type NewWorkspaceEntitlement =
  typeof workspaceEntitlements.$inferInsert;
