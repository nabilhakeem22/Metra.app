// PURE core for editing a org's automation settings. Owner/admin gate is applied
// by the 'use server' wrapper; this validates + writes inside an RLS tx and audits.
import { automationSettings } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { automationFieldErrors } from './settings-field-rules';

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

// The day counts mirror the DB CHECK constraints (./settings-field-rules.ts), so
// a bad value is said under its box, not answered by a raw constraint violation.
const CADENCES = ['daily', 'weekly'] as const;

/** Validate + persist the org's automation settings row. Owner/admin only. */
export async function updateAutomationSettingsCore(
  ctx: OrgContext,
  input: AutomationSettingsInput,
): Promise<ActionResult> {
  // A cadence outside the select: no form can send it.
  if (!CADENCES.includes(input.digestCadence as (typeof CADENCES)[number])) {
    return err('malformed');
  }
  const errors = automationFieldErrors(input);
  if (hasFieldErrors(errors)) return fieldsFailed(errors);

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
