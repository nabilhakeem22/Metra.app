// Draft save (the heaviest proposal core): recompute EVERY total from the money
// engine, never trust a client-supplied subtotal/total, F1-preserve stored costs
// by stable line id. A thin orchestrator over three stages — header validation
// (./draft-save-validate), line resolution (./draft-save-resolve) and persistence
// (./draft-save-persist). Draft-only (proposal_not_draft).
import {
  organizations,
  proposalLines,
  proposalSections,
  proposals,
} from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { computeTotals } from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import { canSeeMargin } from '@/lib/permissions/can';
import type { SaveDraftInput } from './core';
import { enforceLineCaps, validateDraftHeader } from './draft-save-validate';
import { loadCostItemMap, resolveDraftLines } from './draft-save-resolve';
import { persistDraftSectionsAndLines } from './draft-save-persist';

export async function saveProposalDraftCore(
  ctx: OrgContext,
  input: SaveDraftInput,
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'update' },
    async (tx, audit) => {
      const [proposal] = await tx
        .select()
        .from(proposals)
        .where(eq(proposals.id, input.id))
        .limit(1);
      if (!proposal) fail('invalid');
      if (proposal.status !== 'draft') fail('proposal_not_draft');

      // Cost-visibility is org+role scoped: only margin-visible callers may
      // change a cost. (Loaded inside the txn under RLS.)
      const [orgRow] = await tx
        .select({ hide: organizations.hideMarginFromPm })
        .from(organizations)
        .limit(1);
      const seeMargin = canSeeMargin(ctx.role, orgRow?.hide ?? true);

      const header = validateDraftHeader(proposal, input.header ?? {});
      enforceLineCaps(input.sections);

      // F1: snapshot this proposal's current line costs by stable id (BEFORE the
      // rebuild delete wipes them).
      const existingLines = await tx
        .select({ id: proposalLines.id, unitCost: proposalLines.unitCost })
        .from(proposalLines)
        .where(eq(proposalLines.proposalId, input.id));
      const costSnapshot = new Map(
        existingLines.map((line) => [line.id, line.unitCost]),
      );

      const costItemMap = await loadCostItemMap(tx, input.sections);

      // Rebuild sections + lines from scratch (cascade wipes old lines).
      await tx
        .delete(proposalSections)
        .where(eq(proposalSections.proposalId, input.id));

      const { resolvedSections, sectionTotals } = resolveDraftLines(
        input.sections,
        costItemMap,
        costSnapshot,
        seeMargin,
      );
      await persistDraftSectionsAndLines(
        tx,
        ctx.orgId,
        input.id,
        resolvedSections,
      );

      const totals = computeTotals(sectionTotals, {
        discountPct: header.discountPct,
        taxRate: header.taxRate,
        supervisionPct: header.supervisionPct,
      });

      await tx
        .update(proposals)
        .set({
          titleAr: header.titleAr,
          titleEn: header.titleEn,
          issueDate: header.issueDate,
          expiryDate: header.expiryDate,
          currency: header.currency,
          notesAr: header.notesAr,
          notesEn: header.notesEn,
          termsAr: header.termsAr,
          termsEn: header.termsEn,
          discountPct: header.discountPct,
          taxRate: header.taxRate,
          supervisionPct: header.supervisionPct,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxableBase: totals.taxableBase,
          taxAmount: totals.taxAmount,
          supervisionAmount: totals.supervisionAmount,
          total: totals.total,
          totalCost: totals.totalCost,
          totalMargin: totals.totalMargin,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, input.id));

      await audit({
        entity: 'proposal',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { sections: input.sections.length, total: totals.total },
      });
    },
  );
}
