import 'server-only';
import { boqs } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { getEngagementBoqReleasable } from '@/lib/engagements/queries';
import { issueEngagementOf } from './sole-engagement';

/**
 * Could the client open this BOQ the moment the sheet's Issue publishes it? The
 * portal's BOQ rule (`app_boq_releasable`) on the engagement the issue would
 * deliver through, so the confirm tells the studio what the client will see.
 * No such engagement, or no such BOQ: false (the issue itself refuses those).
 */
export async function getBoqIssueReleasable(
  ctx: OrgContext,
  boqId: string,
): Promise<boolean> {
  const [boq] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ engagementId: boqs.engagementId, projectId: boqs.projectId })
      .from(boqs)
      .where(eq(boqs.id, boqId))
      .limit(1),
  );
  if (!boq) return false;
  const engagementId = await issueEngagementOf(ctx, boq);
  return engagementId ? getEngagementBoqReleasable(ctx, engagementId) : false;
}
