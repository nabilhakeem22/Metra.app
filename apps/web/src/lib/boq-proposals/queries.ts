import 'server-only';
import { proposals } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** The engagement's BOQ working copy (one per engagement), or null. */
export async function findEngagementBoqProposalId(
  ctx: OrgContext,
  engagementId: string,
): Promise<string | null> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.engagementId, engagementId), eq(proposals.kind, 'boq')))
      .limit(1),
  );
  return row?.id ?? null;
}
