// sent -> superseded, plus a new draft carrying a deep copy of the sections and
// lines. A sent proposal is immutable, so "revise it" means "replace it".
// Each state change is an ATOMIC admission gate (UPDATE ... WHERE status=...
// RETURNING, check rowCount) — never read-then-write — so concurrent callers
// cannot double-apply it.
import { proposalEvents, proposals, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { allocateNumber } from '@/lib/db/allocate-number';
import { copyProposalContent, supersedingProposalRow } from './supersede-copy';

type ProposalRow = typeof proposals.$inferSelect;

/**
 * Flip sent -> superseded, and hand back the row as it WAS.
 *
 * R1: the transition IS the admission gate. A concurrent 2nd call finds
 * status<>'sent', affects 0 rows, fails `invalid`, and NO copy is made. The
 * RETURNING row carries the original field values (only status flipped), which
 * is what the new draft is built from.
 */
async function supersedeSentProposal(
  tx: MetraDb,
  proposalId: string,
): Promise<ProposalRow> {
  const [original] = await tx
    .update(proposals)
    .set({ status: 'superseded', updatedAt: new Date() })
    .where(and(eq(proposals.id, proposalId), eq(proposals.status, 'sent')))
    .returning();
  if (!original) fail('invalid');
  return original;
}

/** The new draft's row, numbered by the same per-org allocator as a fresh one. */
async function persistSupersedingDraft(
  tx: MetraDb,
  orgId: string,
  original: ProposalRow,
): Promise<{ id: string; number: number }> {
  const number = await allocateNumber(tx, orgId, 'proposals', 'proposals', 'number');
  const [copy] = await tx
    .insert(proposals)
    .values(supersedingProposalRow(original, orgId, number))
    .returning({ id: proposals.id });
  return { id: copy.id, number };
}

/** The append-only ledger row for the transition. The locked row cannot hold it. */
async function recordSupersededEvent(
  tx: MetraDb,
  ctx: OrgContext,
  proposalId: string,
): Promise<void> {
  await tx.insert(proposalEvents).values({
    orgId: ctx.orgId,
    proposalId,
    kind: 'superseded',
    actorUserId: ctx.userId,
    fromStatus: 'sent',
    toStatus: 'superseded',
  });
}

export async function supersedeProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'create' },
    async (tx, audit) => {
      const original = await supersedeSentProposal(tx, input.id);
      const draft = await persistSupersedingDraft(tx, ctx.orgId, original);
      await copyProposalContent(tx, ctx.orgId, original.id, draft.id);
      await recordSupersededEvent(tx, ctx, original.id);
      await audit({
        entity: 'proposal',
        entityId: draft.id,
        action: 'create',
        before: { supersedes: original.id },
        after: { number: draft.number, version: original.version + 1 },
      });
      return draft.id;
    },
  );
}
