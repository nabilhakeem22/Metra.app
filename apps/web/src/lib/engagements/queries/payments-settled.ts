import 'server-only';
import { designEngagements } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * Has the client paid every milestone of this engagement? The same rule the
 * portal uses to release a `boq` (`app_engagement_payments_settled`), read as one
 * scalar so the studio is told what the client will see.
 *
 * Called THROUGH the RLS-scoped engagement row: the SECURITY DEFINER function
 * takes a bare id and would otherwise let a caller probe any engagement
 * (roles.sql). Selecting it from `design_engagements` under RLS means it only
 * ever runs for an id in the caller's org. A missing or foreign row is `false`.
 */
export async function getEngagementPaymentsSettled(
  ctx: OrgContext,
  engagementId: string,
): Promise<boolean> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        settled: sql<boolean>`public.app_engagement_payments_settled(${designEngagements.id})`,
      })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1),
  );
  return row?.settled === true;
}
