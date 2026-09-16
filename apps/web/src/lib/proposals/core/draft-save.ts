// Draft save (the heaviest proposal core): recompute EVERY total from the money
// engine, never trust a client-supplied subtotal/total, F1-preserve stored costs
// by stable line id. A thin orchestrator over named phases — header validation
// (./draft-save-validate), the price-book lookup (./draft-save-cost-items), line
// resolution (./draft-save-resolve) and persistence (./draft-save-persist).
// Draft-only (proposal_not_draft).
import { organizations, proposalLines, proposals } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import type { ActionResult } from '@/lib/actions/result';
import type { MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';
import { canSeeMargin } from '@/lib/permissions/can';
import type { SaveDraftInput } from './types';
import { computeTotalsWithinCap } from './draft-save-caps';
import { loadCostItemMap } from './draft-save-cost-items';
import { enforceLineCaps, validateDraftHeader } from './draft-save-validate';
import { resolveDraftLines } from './draft-save-resolve';
import {
  persistDraftHeaderAndTotals,
  replaceDraftSectionsAndLines,
} from './draft-save-persist';

type ProposalRow = typeof proposals.$inferSelect;

/** The proposal being edited, refusing anything that has left draft. */
async function loadDraftProposal(tx: MetraDb, id: string): Promise<ProposalRow> {
  const [proposal] = await tx
    .select()
    .from(proposals)
    .where(eq(proposals.id, id))
    .limit(1);
  if (!proposal) fail('invalid');
  if (proposal.status !== 'draft') fail('proposal_not_draft');
  return proposal;
}

/**
 * Whether THIS caller may change a cost.
 *
 * Org + role scoped, and read inside the transaction under RLS: a project manager
 * at a firm that hides margin from PMs must not be able to zero a stored cost
 * simply by saving the builder page they are allowed to edit.
 */
async function loadMarginVisibility(tx: MetraDb, ctx: OrgContext): Promise<boolean> {
  const [orgRow] = await tx
    .select({ hide: organizations.hideMarginFromPm })
    .from(organizations)
    .limit(1);
  return canSeeMargin(ctx.role, orgRow?.hide ?? true);
}

/**
 * F1: this proposal's current line costs by stable id, snapshotted BEFORE the
 * rebuild delete wipes them. Without it, every save by a cost-blind caller would
 * silently reprice the document to zero cost.
 */
async function loadCostSnapshot(
  tx: MetraDb,
  proposalId: string,
): Promise<Map<string, string>> {
  const existingLines = await tx
    .select({ id: proposalLines.id, unitCost: proposalLines.unitCost })
    .from(proposalLines)
    .where(eq(proposalLines.proposalId, proposalId));
  return new Map(existingLines.map((line) => [line.id, line.unitCost]));
}

/** The ledger entry a draft save leaves: how much document, and worth what. */
function auditDraftSaved(
  audit: (entry: AuditEntry) => Promise<void>,
  proposalId: string,
  sectionCount: number,
  total: string,
): Promise<void> {
  return audit({
    entity: 'proposal',
    entityId: proposalId,
    action: 'update',
    before: null,
    after: { sections: sectionCount, total },
  });
}

export async function saveProposalDraftCore(
  ctx: OrgContext,
  input: SaveDraftInput,
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'update' },
    async (tx, audit) => {
      const proposal = await loadDraftProposal(tx, input.id);
      const seeMargin = await loadMarginVisibility(tx, ctx);
      const header = validateDraftHeader(proposal, input.header ?? {});
      enforceLineCaps(input.sections);

      const costSnapshot = await loadCostSnapshot(tx, input.id);
      const costItemMap = await loadCostItemMap(tx, input.sections);
      const { resolvedSections, sectionTotals } = resolveDraftLines(
        input.sections,
        costItemMap,
        costSnapshot,
        seeMargin,
      );
      await replaceDraftSectionsAndLines(tx, ctx.orgId, input.id, resolvedSections);
      const totals = computeTotalsWithinCap(sectionTotals, header);
      await persistDraftHeaderAndTotals(tx, input.id, header, totals);
      await auditDraftSaved(audit, input.id, input.sections.length, totals.total);
    },
  );
}
