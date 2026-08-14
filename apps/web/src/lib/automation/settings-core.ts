// PURE core for editing a org's automation settings. Owner/admin gate is applied
// by the 'use server' wrapper; this validates + writes inside an RLS tx and audits.
import { automationSettings } from '@metra/db';
import { eq } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

export interface AutomationSettingsInput {
  expireEnabled: boolean;
  expireNudgeEnabled: boolean;
  expireNudgeLeadDays: number;
  followupEnabled: boolean;
  followupThresholdDays: number;
  digestEnabled: boolean;
  digestCadence: string;
  stageRemindersEnabled: boolean;
}

// Mirror the DB CHECK constraints so a bad value fails with a coded error, not a
// raw constraint violation.
const LEAD_MIN = 1;
const LEAD_MAX = 30;
const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 90;
const CADENCES = ['daily', 'weekly'] as const;

function isValidInt(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

/** Validate + persist the org's automation settings row. Owner/admin only. */
export async function updateAutomationSettingsCore(
  ctx: OrgContext,
  input: AutomationSettingsInput,
): Promise<ActionResult> {
  if (!isValidInt(input.expireNudgeLeadDays, LEAD_MIN, LEAD_MAX)) {
    return err('invalid');
  }
  if (!isValidInt(input.followupThresholdDays, THRESHOLD_MIN, THRESHOLD_MAX)) {
    return err('invalid');
  }
  if (!CADENCES.includes(input.digestCadence as (typeof CADENCES)[number])) {
    return err('invalid');
  }

  return mutateInOrg(
    ctx,
    { capability: 'users_settings', action: 'update' },
    async (tx, audit) => {
      const values = {
        expireEnabled: !!input.expireEnabled,
        expireNudgeEnabled: !!input.expireNudgeEnabled,
        expireNudgeLeadDays: input.expireNudgeLeadDays,
        followupEnabled: !!input.followupEnabled,
        followupThresholdDays: input.followupThresholdDays,
        digestEnabled: !!input.digestEnabled,
        digestCadence: input.digestCadence,
        stageRemindersEnabled: !!input.stageRemindersEnabled,
        updatedAt: new Date(),
      };
      await tx
        .update(automationSettings)
        .set(values)
        .where(eq(automationSettings.orgId, ctx.orgId));

      await audit({
        entity: 'automation_settings',
        entityId: ctx.orgId,
        action: 'update',
        before: null,
        after: values,
      });
    },
  );
}
