import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Per-org automation configuration (P1 Automation) — exactly one row per org.
 * Every locked default (thresholds, cadence, hour) is user-configurable here.
 * RLS: standard org_isolation.
 */
export const automationSettings = pgTable(
  'automation_settings',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    expireEnabled: boolean('expire_enabled').notNull().default(true),
    expireNudgeEnabled: boolean('expire_nudge_enabled').notNull().default(false),
    expireNudgeLeadDays: integer('expire_nudge_lead_days').notNull().default(3),
    followupEnabled: boolean('followup_enabled').notNull().default(true),
    followupThresholdDays: integer('followup_threshold_days')
      .notNull()
      .default(5),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
    digestCadence: text('digest_cadence').notNull().default('weekly'),
    stageRemindersEnabled: boolean('stage_reminders_enabled')
      .notNull()
      .default(true),
  },
  (t) => [
    unique('automation_settings_org_id_id_unique').on(t.orgId, t.id),
    unique('automation_settings_org_id_unique').on(t.orgId),
    check(
      'automation_settings_expire_nudge_lead_days_range',
      sql`expire_nudge_lead_days >= 1 and expire_nudge_lead_days <= 30`,
    ),
    check(
      'automation_settings_followup_threshold_days_range',
      sql`followup_threshold_days >= 1 and followup_threshold_days <= 90`,
    ),
    check(
      'automation_settings_digest_cadence_valid',
      sql`digest_cadence in ('daily', 'weekly')`,
    ),
  ],
);

export type AutomationSettings = typeof automationSettings.$inferSelect;
export type NewAutomationSettings = typeof automationSettings.$inferInsert;
