import 'server-only';
import { designEngagements } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';

/**
 * The delivery an issue goes through, and the client it was sold to. A BOQ
 * issued through it becomes THAT client's (H3 round 2): a project's client can
 * change while its delivery runs, and a delivery owns only its own client's
 * BOQs (`app_delivery_boqs`).
 */
export interface IssueEngagement {
  id: string;
  clientId: string;
}

const issueEngagementColumns = { id: designEngagements.id, clientId: designEngagements.clientId };

/** The engagement a BOQ is already attached to, or null when RLS hides it. */
async function attachedEngagement(
  ctx: OrgContext,
  engagementId: string,
): Promise<IssueEngagement | null> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select(issueEngagementColumns)
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1),
  );
  return row ?? null;
}

/**
 * The project's one active engagement, or null when there is none — or more than
 * one, because guessing between two is worse than asking.
 */
async function soleActiveEngagement(
  ctx: OrgContext,
  projectId: string,
): Promise<IssueEngagement | null> {
  const rows = await withOrgContext(ctx, (tx) =>
    tx
      .select(issueEngagementColumns)
      .from(designEngagements)
      .where(
        and(
          eq(designEngagements.projectId, projectId),
          ne(designEngagements.state, 'abandoned'),
        ),
      )
      .limit(2),
  );
  return rows.length === 1 ? (rows[0] ?? null) : null;
}

/**
 * The engagement an issue of this BOQ delivers through: the one it is already
 * attached to, else the project's sole active one. Resolved at issue time rather
 * than at creation, so a BOQ built before the engagement existed can still be
 * issued. Null means there is nobody to deliver it to.
 */
export async function issueEngagementOf(
  ctx: OrgContext,
  boq: { engagementId: string | null; projectId: string },
): Promise<IssueEngagement | null> {
  return boq.engagementId
    ? attachedEngagement(ctx, boq.engagementId)
    : soleActiveEngagement(ctx, boq.projectId);
}
