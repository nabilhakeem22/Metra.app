import 'server-only';
import { designEngagements, engagementMilestones } from '@metra/db';
import { desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { LastFeeSchedule } from '../default-fee-split';

/**
 * The org's most recently WRITTEN fee schedule, for the fee form's prefill: the
 * engagement of the newest milestone row (any state, abandoned included), with
 * all of its milestones and its design fee. No schema change: the split is read
 * back off the milestones it produced. Null when the org has never written one.
 * RLS scopes every read to the caller's org.
 */
export function getLastUsedFeeSchedule(ctx: OrgContext): Promise<LastFeeSchedule | null> {
  return withOrgContext(ctx, async (tx) => {
    const [newest] = await tx
      .select({ engagementId: engagementMilestones.engagementId })
      .from(engagementMilestones)
      .orderBy(desc(engagementMilestones.createdAt), desc(engagementMilestones.engagementId))
      .limit(1);
    if (!newest) return null;

    const milestones = await tx
      .select({
        kind: engagementMilestones.kind,
        basis: engagementMilestones.basis,
        value: engagementMilestones.value,
      })
      .from(engagementMilestones)
      .where(eq(engagementMilestones.engagementId, newest.engagementId));
    const [engagement] = await tx
      .select({ designFee: designEngagements.designFee })
      .from(designEngagements)
      .where(eq(designEngagements.id, newest.engagementId))
      .limit(1);
    return { designFee: engagement?.designFee ?? null, milestones };
  });
}
