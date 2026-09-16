// sent -> superseded, plus a new draft carrying a deep copy of the sections and
// lines. A sent proposal is immutable, so "revise it" means "replace it".
// Each state change is an ATOMIC admission gate (UPDATE ... WHERE status=...
// RETURNING, check rowCount) — never read-then-write — so concurrent callers
// cannot double-apply it.
import {
  proposalEvents,
  proposalLines,
  proposalSections,
  proposals,
} from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { allocateNumber } from '@/lib/db/allocate-number';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';

export async function supersedeProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'create' },
    async (tx, audit) => {
      // R1: the sent->superseded transition IS the admission gate. A concurrent
      // 2nd call finds status<>'sent' -> 0 rows -> invalid, and NO copy is made.
      // The returned row carries the original field values (only status flipped).
      const [old] = await tx
        .update(proposals)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(and(eq(proposals.id, input.id), eq(proposals.status, 'sent')))
        .returning();
      if (!old) fail('invalid');

      const number = await allocateNumber(
        tx,
        ctx.orgId,
        'proposals',
        'proposals',
        'number',
      );
      const [copy] = await tx
        .insert(proposals)
        .values({
          orgId: ctx.orgId,
          number,
          titleAr: old.titleAr,
          titleEn: old.titleEn,
          clientId: old.clientId,
          projectId: old.projectId,
          status: 'draft',
          currency: old.currency,
          issueDate: old.issueDate,
          expiryDate: old.expiryDate,
          discountPct: old.discountPct,
          taxRate: old.taxRate,
          supervisionPct: old.supervisionPct,
          subtotal: old.subtotal,
          discountAmount: old.discountAmount,
          taxableBase: old.taxableBase,
          taxAmount: old.taxAmount,
          supervisionAmount: old.supervisionAmount,
          total: old.total,
          totalCost: old.totalCost,
          totalMargin: old.totalMargin,
          notesAr: old.notesAr,
          notesEn: old.notesEn,
          termsAr: old.termsAr,
          termsEn: old.termsEn,
          version: old.version + 1,
          supersedesId: old.id,
        })
        .returning({ id: proposals.id });

      // Deep-copy sections + lines into the new draft (batched, no N+1).
      const oldSections = await tx
        .select()
        .from(proposalSections)
        .where(eq(proposalSections.proposalId, old.id))
        .orderBy(proposalSections.sortOrder);
      if (oldSections.length) {
        const newSecs = await tx
          .insert(proposalSections)
          .values(
            oldSections.map((s) => ({
              orgId: ctx.orgId,
              proposalId: copy.id,
              titleAr: s.titleAr,
              titleEn: s.titleEn,
              sortOrder: s.sortOrder,
              sectionSubtotal: s.sectionSubtotal,
            })),
          )
          .returning({ id: proposalSections.id });
        const idMap = new Map(oldSections.map((s, i) => [s.id, newSecs[i].id]));

        const oldLines = await tx
          .select()
          .from(proposalLines)
          .where(eq(proposalLines.proposalId, old.id));
        const newLineRows = oldLines.map((l) => ({
          orgId: ctx.orgId,
          proposalId: copy.id,
          sectionId: idMap.get(l.sectionId)!,
          costItemId: l.costItemId,
          descriptionAr: l.descriptionAr,
          descriptionEn: l.descriptionEn,
          qty: l.qty,
          unit: l.unit,
          unitCost: l.unitCost,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          lineCost: l.lineCost,
          lineTotal: l.lineTotal,
          lineMargin: l.lineMargin,
          sortOrder: l.sortOrder,
        }));
        await insertLinesInChunks(tx, proposalLines, newLineRows);
      }

      await tx.insert(proposalEvents).values({
        orgId: ctx.orgId,
        proposalId: old.id,
        kind: 'superseded',
        actorUserId: ctx.userId,
        fromStatus: 'sent',
        toStatus: 'superseded',
      });

      await audit({
        entity: 'proposal',
        entityId: copy.id,
        action: 'create',
        before: { supersedes: old.id },
        after: { number, version: old.version + 1 },
      });
      return copy.id;
    },
  );
}
