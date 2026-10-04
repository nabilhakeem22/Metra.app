import 'server-only';
import { designEngagements } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';

/**
 * The project's one active engagement, or null when there is none — or more than
 * one, because guessing between two is worse than asking.
 */
export async function soleActiveEngagement(
  ctx: OrgContext,
  projectId: string,
): Promise<string | null> {
  const rows = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: designEngagements.id })
      .from(designEngagements)
      .where(
        and(
          eq(designEngagements.projectId, projectId),
          ne(designEngagements.state, 'abandoned'),
        ),
      )
      .limit(2),
  );
  return rows.length === 1 ? (rows[0]?.id ?? null) : null;
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
): Promise<string | null> {
  return boq.engagementId ?? (await soleActiveEngagement(ctx, boq.projectId));
}
