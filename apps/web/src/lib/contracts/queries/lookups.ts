import 'server-only';
import { contracts } from '@metra/db';
import { eq, inArray } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** The contract generated from a given proposal, if any (for the proposal view). */
export async function getContractIdForProposal(
  ctx: OrgContext,
  proposalId: string,
): Promise<string | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.sourceProposalId, proposalId))
      .limit(1);
    return row?.id ?? null;
  });
}

/** Which accepted proposals in a project already have a contract (for the UI). */
export async function getContractedProposalIds(
  ctx: OrgContext,
  proposalIds: string[],
): Promise<Set<string>> {
  if (proposalIds.length === 0) return new Set();
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({ sourceProposalId: contracts.sourceProposalId })
      .from(contracts)
      .where(inArray(contracts.sourceProposalId, proposalIds));
    // `inArray` on the column never matches a null, so every row names a
    // proposal; the filter only narrows the type (BOQ contracts carry null, 0063).
    return new Set(
      rows.flatMap((row) => (row.sourceProposalId === null ? [] : [row.sourceProposalId])),
    );
  });
}

/** The execution contract generated from a given BOQ, if any (for the BOQ tab). */
export async function getContractIdForBoq(ctx: OrgContext, boqId: string): Promise<string | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.sourceBoqId, boqId))
      .limit(1);
    return row?.id ?? null;
  });
}
