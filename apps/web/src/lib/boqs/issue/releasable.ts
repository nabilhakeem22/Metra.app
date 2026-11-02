import 'server-only';
import { boqs } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { getEngagementBoqReleasable } from '@/lib/engagements/queries';
import { issueEngagementOf } from './sole-engagement';

/** What the sheet's Issue needs to know before it is pressed. */
export interface BoqIssueReadiness {
  /** There is one delivery to issue through; without one the issue answers `boq_needs_delivery`. */
  hasDelivery: boolean;
  /** Could the client open this BOQ the moment it is published: the portal's BOQ rule on that delivery. */
  clientCanOpen: boolean;
}

const NOT_READY: BoqIssueReadiness = { hasDelivery: false, clientCanOpen: false };

/**
 * The readiness of an issue through the engagement it would deliver through, so
 * the tab can turn Issue off and the confirm tell the studio what the client will
 * see (`app_boq_releasable`). No such BOQ reads as not ready: the issue refuses it.
 */
export async function getBoqIssueReadiness(
  ctx: OrgContext,
  boqId: string,
): Promise<BoqIssueReadiness> {
  const [boq] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ engagementId: boqs.engagementId, projectId: boqs.projectId })
      .from(boqs)
      .where(eq(boqs.id, boqId))
      .limit(1),
  );
  if (!boq) return NOT_READY;
  const engagement = await issueEngagementOf(ctx, boq);
  if (!engagement) return NOT_READY;
  return { hasDelivery: true, clientCanOpen: await getEngagementBoqReleasable(ctx, engagement.id) };
}
