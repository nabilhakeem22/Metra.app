import 'server-only';
import {
  designEngagements,
  engagementMilestones,
  type MilestoneBasis,
  type MilestoneKind,
} from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** A single milestone in a fee schedule (money as a scale-4 string). */
export interface FeeScheduleMilestone {
  kind: MilestoneKind;
  basis: MilestoneBasis;
  value: string;
  sortOrder: number;
}

/**
 * The fee schedule for an engagement: the design fee plus its ordered milestones.
 * `designFee` is null until `submitDesignFee` has fired. All money is returned as
 * scale-4 strings — the API/UI layer applies 2-decimal formatting, not this query.
 * RLS scopes both reads to the caller's org (a foreign engagement reads as empty).
 */
export interface EngagementFeeSchedule {
  designFee: string | null;
  milestones: FeeScheduleMilestone[];
}

export function getEngagementFeeSchedule(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementFeeSchedule> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select({ designFee: designEngagements.designFee })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    const milestones = await tx
      .select({
        kind: engagementMilestones.kind,
        basis: engagementMilestones.basis,
        value: engagementMilestones.value,
        sortOrder: engagementMilestones.sortOrder,
      })
      .from(engagementMilestones)
      .where(eq(engagementMilestones.engagementId, engagementId))
      .orderBy(asc(engagementMilestones.sortOrder));

    return { designFee: engagement?.designFee ?? null, milestones };
  });
}
