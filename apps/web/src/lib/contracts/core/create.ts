// Contract generation: generateContractCore. Deep-copies an ACCEPTED proposal's
// sections, lines and FROZEN totals into a new DRAFT contract — the server never
// recomputes them here (the contract baseline must equal the accepted quote to
// the piastre).
//
// Five named phases: load the accepted proposal, load the inherited percentages,
// persist the header (./create-header.ts), copy the sections and lines
// (./create-copy.ts), audit. The transaction boundary is unchanged — all five
// run inside the one `mutateInOrg`, so any failure rolls the whole thing back.
import { contracts, proposals, clients, projects, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { copyProposalContentToContract } from './create-copy';
import { persistContractHeader } from './create-header';

export interface GenerateContractInput {
  proposalId: string;
}

type ProposalRow = typeof proposals.$inferSelect;

/**
 * The accepted proposal this contract is generated from.
 *
 * Also the duplicate fast path (AC2): one contract per proposal. The unique index
 * on (org_id, source_proposal_id) is the REAL race guard — this check only spares
 * the common case an insert that would have failed anyway.
 */
async function loadAcceptedProposal(
  tx: MetraDb,
  proposalId: string,
): Promise<ProposalRow> {
  const [proposal] = await tx
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!proposal) fail('invalid');
  if (proposal.status !== 'accepted') fail('proposal_not_accepted');

  const existing = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.sourceProposalId, proposalId))
    .limit(1);
  if (existing[0]) fail('contract_exists');
  return proposal;
}

/** A configured (non-null) percentage, or undefined so the caller can fall back. */
function pickPct(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

/**
 * Retention and advance inherit project -> client -> 0.
 *
 * Zero when unset, deliberately: A4 forbids seeding an industry-typical figure a
 * firm never agreed to.
 */
async function loadInheritedPercentages(
  tx: MetraDb,
  proposal: ProposalRow,
): Promise<{ advancePct: string; retentionPct: string }> {
  const [project] = await tx
    .select({ advancePct: projects.advancePct, retentionPct: projects.retentionPct })
    .from(projects)
    .where(eq(projects.id, proposal.projectId))
    .limit(1);
  const [client] = await tx
    .select({ advancePct: clients.advancePct, retentionPct: clients.retentionPct })
    .from(clients)
    .where(eq(clients.id, proposal.clientId))
    .limit(1);
  return {
    advancePct: pickPct(project?.advancePct) ?? pickPct(client?.advancePct) ?? '0',
    retentionPct:
      pickPct(project?.retentionPct) ?? pickPct(client?.retentionPct) ?? '0',
  };
}

/** The contract's per-org number, serialized by a transaction-scoped advisory
 *  lock so two concurrent generates can never collide on it. */
function allocateContractNumber(tx: MetraDb, orgId: string): Promise<number> {
  return allocateNumber(tx, orgId, 'contracts', 'contracts', 'number');
}

/** The ledger entry a generated contract leaves: which number, from which quote. */
function auditContractGenerated(
  audit: (entry: AuditEntry) => Promise<void>,
  contractId: string,
  number: number,
  proposalId: string,
): Promise<void> {
  return audit({
    entity: 'contract',
    entityId: contractId,
    action: 'create',
    before: null,
    after: { number, source_proposal_id: proposalId },
  });
}

/**
 * Generate a DRAFT contract from an ACCEPTED proposal: deep-copy its sections,
 * lines and totals; `originalValue` = the accepted proposal total (to the
 * piastre). One contract per proposal (unique (org_id, source_proposal_id)); a
 * second attempt returns `contract_exists` and writes no row. Retention/advance
 * inherit project -> client -> 0 (A4: 0 when unset; no industry seed values).
 */
export async function generateContractCore(
  ctx: OrgContext,
  input: GenerateContractInput,
): Promise<ActionResult> {
  const proposalId = input.proposalId?.trim();
  if (!proposalId || !isUuid(proposalId)) return err('invalid');

  return mutateInOrg(
    ctx,
    {
      capability: 'contracts_generate',
      action: 'create',
      // (org_id, source_proposal_id) is unique: two studios pressing Generate on
      // the same accepted proposal is a NORMAL race, and the loser's 23505 means
      // exactly one thing here — the contract it wanted already exists. Naming it
      // keeps `generic` (and a false `mutateInOrg failed` log line) off the path.
      conflictCode: 'contract_exists',
    },
    async (tx, audit) => {
      const proposal = await loadAcceptedProposal(tx, proposalId);
      const percentages = await loadInheritedPercentages(tx, proposal);
      const number = await allocateContractNumber(tx, ctx.orgId);
      const contractId = await persistContractHeader(
        tx, ctx.orgId, proposal, number, percentages,
      );
      await copyProposalContentToContract(tx, ctx.orgId, proposalId, contractId);
      await auditContractGenerated(audit, contractId, number, proposalId);
      return contractId;
    },
  );
}
