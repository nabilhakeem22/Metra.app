import {
  index,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Append-only idempotency claim log (P1 Automation). Each automation, per org
 * per period, FIRST inserts `(automation_key, period_key)` with
 * onConflictDoNothing and only proceeds if it wins the claim — so two
 * overlapping cron runs produce exactly one effect. metra_app has SELECT+INSERT
 * only (no UPDATE/DELETE). RLS: standard org_isolation.
 */
export const automationRunLog = pgTable(
  'automation_run_log',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    automationKey: text('automation_key').notNull(),
    periodKey: text('period_key').notNull(),
  },
  (t) => [
    unique('automation_run_log_org_id_id_unique').on(t.orgId, t.id),
    unique('automation_run_log_org_key_period_unique').on(
      t.orgId,
      t.automationKey,
      t.periodKey,
    ),
    index('automation_run_log_org_created_idx').on(t.orgId, t.createdAt),
  ],
);

export type AutomationRunLog = typeof automationRunLog.$inferSelect;
export type NewAutomationRunLog = typeof automationRunLog.$inferInsert;
