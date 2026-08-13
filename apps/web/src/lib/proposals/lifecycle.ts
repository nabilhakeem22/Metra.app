// Proposal lifecycle transitions. Each state change is an ATOMIC admission gate
// (UPDATE ... WHERE status=... RETURNING, check rowCount) — never read-then-write
// — so concurrent callers can't double-send / double-supersede. Accept/reject
// metadata lives in the append-only events table (the locked row can't hold it).
import {
  proposalEvents,
  proposalLines,
  proposalSections,
  proposals,
} from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { OrgContext } from '@/lib/db/context';
import { chunk, LINE_INSERT_CHUNK, mintToken, nextNumber, SHARE_TTL_DAYS } from './core';

export async function sendProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_send', action: 'approve' },
    async (tx, audit) => {
      const { raw, hash } = mintToken();
      const shareExpiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86400_000);

      // R3: the draft->sent transition IS the admission gate. A concurrent 2nd
      // send finds status<>'draft' -> 0 rows -> proposal_not_draft, no event, no
      // link (and never overwrites the live token).
      const gated = await tx
        .update(proposals)
        .set({
          status: 'sent',
          tokenHash: hash,
          shareExpiresAt,
          updatedAt: new Date(),
        })
        .where(and(eq(proposals.id, input.id), eq(proposals.status, 'draft')))
        .returning({ id: proposals.id, clientId: proposals.clientId });
      if (!gated[0]) fail('proposal_not_draft');

      await tx.insert(proposalEvents).values({
        orgId: ctx.orgId,
        proposalId: input.id,
        kind: 'sent',
        actorUserId: ctx.userId,
        fromStatus: 'draft',
        toStatus: 'sent',
      });

      // Client activity feed: a proposal was sent.
      await appendSystemActivity(tx, ctx, {
        entityType: 'client',
        entityId: gated[0].clientId,
        kind: 'proposal_sent',
        meta: { proposal_id: input.id },
      });

      await audit({
        entity: 'proposal',
        entityId: input.id,
        action: 'issue',
        before: { status: 'draft' },
        after: { status: 'sent' },
      });
      // The raw token — the action wrapper turns it into the public link.
      return raw;
    },
  );
}

export async function expireProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_send', action: 'approve' },
    async (tx) => {
      const updated = await tx
        .update(proposals)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(proposals.id, input.id), eq(proposals.status, 'sent')))
        .returning({ id: proposals.id });
      if (!updated[0]) fail('invalid');

      await tx.insert(proposalEvents).values({
        orgId: ctx.orgId,
        proposalId: input.id,
        kind: 'expired',
        actorUserId: ctx.userId,
        fromStatus: 'sent',
        toStatus: 'expired',
      });
    },
  );
}

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

      const number = await nextNumber(tx, ctx.orgId);
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
        for (const part of chunk(newLineRows, LINE_INSERT_CHUNK)) {
          await tx.insert(proposalLines).values(part);
        }
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

export async function deleteDraftProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'update' },
    async (tx, audit) => {
      const [proposal] = await tx
        .select({ status: proposals.status })
        .from(proposals)
        .where(eq(proposals.id, input.id))
        .limit(1);
      if (!proposal) fail('invalid');
      if (proposal.status !== 'draft') fail('proposal_not_draft');

      await tx.delete(proposals).where(eq(proposals.id, input.id));
      await audit({
        entity: 'proposal',
        entityId: input.id,
        action: 'delete',
        before: { status: 'draft' },
        after: null,
      });
    },
  );
}
