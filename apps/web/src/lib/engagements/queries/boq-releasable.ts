import 'server-only';
import { designEngagements } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * May the client open this engagement's BOQ? The SAME rule the portal applies to
 * a `boq` (`app_boq_releasable`): the engagement HAS a fee schedule and every
 * milestone of it is paid. Read as one scalar so the studio is told what the
 * client will see (the BOQ step's chip and both issue confirms).
 *
 * Deliberately not the bare settled test: an engagement with no milestones is
 * "settled" for every other deliverable, but its BOQ stays withheld.
 *
 * Called THROUGH the RLS-scoped engagement row: the SECURITY DEFINER function
 * takes a bare id and would otherwise let a caller probe any engagement
 * (roles.sql). Selecting it from `design_engagements` under RLS means it only
 * ever runs for an id in the caller's org. A missing or foreign row is `false`.
 */
export async function getEngagementBoqReleasable(
  ctx: OrgContext,
  engagementId: string,
): Promise<boolean> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        releasable: sql<boolean>`public.app_boq_releasable(${designEngagements.id})`,
      })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1),
  );
  return row?.releasable === true;
}
