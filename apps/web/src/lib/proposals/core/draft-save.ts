// Draft save (the heaviest proposal core): recompute EVERY total from the money
// engine, never trust a client-supplied subtotal/total, F1-preserve stored costs
// by stable line id. A thin orchestrator over named phases — header validation
// (./draft-save-validate), the price-book lookup (./draft-save-cost-items), line
// resolution (./draft-save-resolve), the write plan against what is stored
// (./draft-save-stored, ./draft-save-diff) and persistence (./draft-save-persist).
// Draft-only (proposal_not_draft).
//
// ONE WRITER AT A TIME. The proposal row is locked FOR UPDATE before anything is
// read, so two saves of one draft (two tabs, a leave-save racing a new mount, a
// save racing a delete or a send) serialise on it, and the stored rows the write
// plan is diffed against are read only after it. Without the lock the second
// save could plan against rows the first was still replacing and the draft kept
// BOTH sets. The caller's revision token then refuses a save made from a stale
// copy (`draft_changed_elsewhere`) instead of overwriting.
import { organizations, proposals } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';
import { canSeeMargin } from '@/lib/permissions/can';
import { proposalRevision } from '../revision';
import { isSaveDraftInputShape } from './draft-save-shape';
import type { DraftSaveReceipt, SaveDraftInput } from './types';
import { auditDraftSaved } from './draft-save-audit';
import { computeTotalsWithinCap } from './draft-save-caps';
import { loadCostItemMap } from './draft-save-cost-items';
import {
  enforceLineCaps,
  pricingForKind,
  validateDraftHeader,
} from './draft-save-validate';
import { resolveDraftLines } from './draft-save-resolve';
import { planDraftWrite } from './draft-save-diff';
import { applyDraftWritePlan, persistDraftHeaderAndTotals } from './draft-save-persist';
import { loadStoredDraft, storedCostsById } from './draft-save-stored';

type ProposalRow = typeof proposals.$inferSelect;

/**
 * The proposal being edited, LOCKED for the rest of the transaction, refusing
 * anything that has left draft or moved on since the caller's revision.
 */
async function lockDraftProposal(
  tx: MetraDb,
  id: string,
  expectedRevision: string | undefined,
): Promise<ProposalRow> {
  const [locked] = await tx
    .select({ proposal: proposals, revision: proposalRevision })
    .from(proposals)
    .where(eq(proposals.id, id))
    .limit(1)
    .for('update');
  if (!locked) fail('invalid');
  if (locked.proposal.status !== 'draft') fail('proposal_not_draft');
  if (expectedRevision !== undefined && locked.revision !== expectedRevision) {
    fail('draft_changed_elsewhere');
  }
  return locked.proposal;
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

export async function saveProposalDraftCore(
  ctx: OrgContext,
  input: SaveDraftInput,
): Promise<ActionResult & { data?: DraftSaveReceipt }> {
  if (!isSaveDraftInputShape(input)) return err('invalid');
  return mutateInOrg(
    ctx,
    {
      capability: 'proposals_build',
      action: 'update',
      // A draft save racing a send is a NORMAL race: the loser blocks on the
      // send's row lock, then `trg_proposals_immutable` raises MT100 and the
      // whole transaction rolls back. The proposal is no longer a draft, which
      // is a sentence the catalogue already has in both languages — see
      // `draft-save-persist.ts`, which described this defect in prose.
      immutableCode: 'proposal_not_draft',
    },
    async (tx, audit) => {
      const proposal = await lockDraftProposal(tx, input.id, input.revision);
      const seeMargin = await loadMarginVisibility(tx, ctx);
      const header = pricingForKind(
        proposal.kind,
        validateDraftHeader(proposal, input.header ?? {}),
      );
      enforceLineCaps(input.sections);

      const stored = await loadStoredDraft(tx, input.id);
      const costItemMap = await loadCostItemMap(tx, input.sections);
      const { resolvedSections, sectionTotals } = resolveDraftLines(
        input.sections,
        costItemMap,
        storedCostsById(stored),
        seeMargin,
      );
      const plan = planDraftWrite(resolvedSections, stored);
      await applyDraftWritePlan(tx, ctx.orgId, input.id, plan);
      const totals = computeTotalsWithinCap(sectionTotals, header);
      const revision = await persistDraftHeaderAndTotals(tx, input.id, header, totals);
      await auditDraftSaved(tx, audit, {
        proposalId: input.id,
        actorUserId: ctx.userId,
        sectionCount: input.sections.length,
        lineCount: input.sections.reduce((count, section) => count + section.lines.length, 0),
        total: totals.total,
      });
      return { revision, sections: plan.receipt };
    },
  );
}
