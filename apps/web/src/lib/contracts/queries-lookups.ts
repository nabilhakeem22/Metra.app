import 'server-only';
import { clients, contracts } from '@metra/db';
import { eq, inArray } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ContractSendMeta {
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  originalValue: string;
  clientEmail: string | null;
}

/** Non-cost fields the issue path needs for the client email (never cost). */
export async function getContractSendMeta(
  ctx: OrgContext,
  id: string,
): Promise<ContractSendMeta | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        number: contracts.number,
        titleAr: contracts.titleAr,
        titleEn: contracts.titleEn,
        originalValue: contracts.originalValue,
        clientEmail: clients.email,
      })
      .from(contracts)
      .leftJoin(clients, eq(clients.id, contracts.clientId))
      .where(eq(contracts.id, id))
      .limit(1);
    return row ?? null;
  });
}

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
    return new Set(rows.map((r) => r.sourceProposalId));
  });
}
