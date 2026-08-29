// Design-Engagement Machine — `setEngagementOffPlan`, the proposal-stage toggle
// between an EXISTING unit (needs a measured site survey) and an OFF-PLAN /
// on-the-map unit (a developer AutoCAD import stands in for the survey). This is
// PLAIN data entry, NOT a machine transition: it never moves state and touches no
// trigger. It writes the pre-existing `off_plan` boolean on `design_engagements`
// (migration 0021); the `spatialBaseReady` guard already branches on it (a CAD
// set satisfies survey → layout only when off_plan). The engagement is verified
// in-org (RLS scopes the read) and non-terminal before the write, so a caller
// cannot flip off-plan on a foreign or finished engagement.
import { designEngagements } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';

export interface SetEngagementOffPlanInput {
  engagementId: string;
  offPlan: boolean;
}

/**
 * Set whether an engagement is off-plan. Gated on the `engagements_design`
 * capability (update — the same cell `setEngagementRom` uses). Flow: open the RLS
 * tx; validate the input is a boolean (`invalid`); assert the engagement resolves
 * in-org (`engagement_not_found` if absent/foreign) and is NOT terminal
 * (`engagement_not_active`); refuse if it is past the proposal window
 * (`off_plan_locked` — the flag has already fed the machine and freezing it keeps
 * off_plan and as_built_due in sync); then persist the boolean and audit the
 * change. Returns ok. Never throws to the client — coded ActionResult only.
 */
export async function setEngagementOffPlanCore(
  ctx: OrgContext,
  input: SetEngagementOffPlanInput,
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      if (typeof input.offPlan !== 'boolean') fail('invalid');

      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, input.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      if (isTerminal(engagement.state)) fail('engagement_not_active');
      // Freeze off_plan once it has fed the machine: `as_built_due` is snapshotted
      // from off_plan at `confirmAndPayDeposit`, and off_plan drives
      // `spatialBaseReady`. Flipping it after the deposit would desync off_plan vs
      // as_built_due into an un-fixable state — so it is editable ONLY in the
      // proposal window (created / design_proposal), matching the UI toggle.
      if (
        engagement.state !== 'created' &&
        engagement.state !== 'design_proposal'
      ) {
        fail('off_plan_locked');
      }

      await tx
        .update(designEngagements)
        .set({ offPlan: input.offPlan, updatedAt: new Date() })
        .where(eq(designEngagements.id, input.engagementId));

      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'update',
        before: null,
        after: { off_plan: input.offPlan },
      });
    },
  );
}
