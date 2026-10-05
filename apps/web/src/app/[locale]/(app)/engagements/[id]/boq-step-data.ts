import 'server-only';
// What the delivery's BOQ step renders from, read on the server. Split out of
// engagement-detail-data.ts, which joins it to its one Promise.all.
import { findEngagementBoqProposalId } from '@/lib/boq-proposals/queries';
import { getProjectBoqSummary, isBoqSharedOnEngagement } from '@/lib/boqs/queries';
import type { BoqStepData } from '@/lib/boqs/step';
import type { OrgContext } from '@/lib/db/context';
import { getEngagementBoqReleasable } from '@/lib/engagements/queries';
import { can } from '@/lib/permissions/can';

/**
 * The project's current BOQ, the engagement's working copy and the BOQ release
 * rule in parallel; then, only for an issued BOQ, whether its PDF is actually in
 * this engagement's delivery link (the done step says "sent" only if it is).
 */
export async function loadBoqStep(
  ctx: OrgContext,
  ids: { engagementId: string; projectId: string },
): Promise<BoqStepData> {
  const [current, boqProposalId, clientCanOpen] = await Promise.all([
    getProjectBoqSummary(ctx, ids.projectId),
    findEngagementBoqProposalId(ctx, ids.engagementId),
    getEngagementBoqReleasable(ctx, ids.engagementId),
  ]);
  const sharedWithClient =
    current !== null && current.status !== 'draft'
      ? await isBoqSharedOnEngagement(ctx, {
          engagementId: ids.engagementId,
          documentNumber: current.documentNumber,
        })
      : false;
  return {
    current,
    boqProposalId,
    clientCanOpen,
    sharedWithClient,
    canBuild: can(ctx.role, 'proposals_build', 'create') && can(ctx.role, 'boq_build', 'create'),
  };
}
