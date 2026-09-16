import 'server-only';
// Writing the contract's own row, from the accepted proposal it is generated
// from. Nothing here is recomputed — see `contractTotalsFromProposal`.
import { contracts, proposals, type MetraDb } from '@metra/db';
import { fail } from '@/lib/actions/mutate';
import { formatDocNumber } from '@/lib/format/doc-number';

type ProposalRow = typeof proposals.$inferSelect;

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/**
 * The FROZEN money the contract inherits, value for value.
 *
 * Not one figure is recomputed. The contract baseline must equal the accepted
 * quote to the piastre, and a recomputation that came out a piastre different —
 * a rounding rule changed in the meantime, say — would be a contract the client
 * never agreed to.
 */
function contractTotalsFromProposal(proposal: ProposalRow) {
  return {
    originalValue: proposal.total,
    discountPct: proposal.discountPct,
    taxRate: proposal.taxRate,
    supervisionPct: proposal.supervisionPct,
    subtotal: proposal.subtotal,
    discountAmount: proposal.discountAmount,
    taxableBase: proposal.taxableBase,
    taxAmount: proposal.taxAmount,
    supervisionAmount: proposal.supervisionAmount,
    totalCost: proposal.totalCost,
    totalMargin: proposal.totalMargin,
  };
}

/**
 * The contract's English title.
 *
 * The source proposal always carries a title in at least one language
 * (bilingualCheck), so the snapshot satisfies the contract's own present-check.
 * The display-number fallback covers only the impossible both-null case.
 */
function contractTitleEn(proposal: ProposalRow, number: number): string | null {
  if (proposal.titleAr || proposal.titleEn) return proposal.titleEn;
  return formatDocNumber('C', number, new Date(proposal.createdAt).getFullYear());
}

/** Insert the contract row and return its id. */
export async function persistContractHeader(
  tx: MetraDb,
  orgId: string,
  proposal: ProposalRow,
  number: number,
  percentages: { advancePct: string; retentionPct: string },
): Promise<string> {
  try {
    const [row] = await tx
      .insert(contracts)
      .values({
        orgId,
        number,
        titleAr: proposal.titleAr,
        titleEn: contractTitleEn(proposal, number),
        sourceProposalId: proposal.id,
        clientId: proposal.clientId,
        projectId: proposal.projectId,
        currency: proposal.currency,
        ...percentages,
        ...contractTotalsFromProposal(proposal),
      })
      .returning({ id: contracts.id });
    return row.id;
  } catch (e) {
    // Lost the race for (org_id, source_proposal_id): one contract already exists.
    if (isUniqueViolation(e)) fail('contract_exists');
    throw e;
  }
}
