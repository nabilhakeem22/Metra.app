// draft -> sent: mint the share token, open the client's window, tell the feed.
// Each state change is an ATOMIC admission gate (UPDATE ... WHERE status=...
// RETURNING, check rowCount) — never read-then-write — so concurrent callers
// cannot double-apply it.
// Accept/reject metadata lives in the append-only events table, because the row
// locks on send and cannot hold it.
import { proposalEvents, proposals, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { OrgContext } from '@/lib/db/context';
import { mintShareToken, shareExpiryFromNow } from '@/lib/share/token';

/**
 * Flip draft -> sent and stamp the share token, returning the client the link is
 * for.
 *
 * R3: the transition IS the admission gate. A concurrent 2nd send finds
 * status<>'draft', affects 0 rows, fails `proposal_not_draft` — no event, no
 * second link, and the live token is never overwritten.
 */
async function sendDraftProposal(
  tx: MetraDb,
  proposalId: string,
  tokenHash: string,
  shareExpiresAt: Date,
): Promise<{ clientId: string }> {
  const gated = await tx
    .update(proposals)
    .set({ status: 'sent', tokenHash, shareExpiresAt, updatedAt: new Date() })
    .where(and(eq(proposals.id, proposalId), eq(proposals.status, 'draft')))
    .returning({ id: proposals.id, clientId: proposals.clientId });
  if (!gated[0]) fail('proposal_not_draft');
  return { clientId: gated[0].clientId };
}

/** The append-only ledger row for the transition, plus the client's feed entry. */
async function recordSentEvent(
  tx: MetraDb,
  ctx: OrgContext,
  proposalId: string,
  clientId: string,
): Promise<void> {
  await tx.insert(proposalEvents).values({
    orgId: ctx.orgId,
    proposalId,
    kind: 'sent',
    actorUserId: ctx.userId,
    fromStatus: 'draft',
    toStatus: 'sent',
  });
  await appendSystemActivity(tx, ctx, {
    entityType: 'client',
    entityId: clientId,
    kind: 'proposal_sent',
    meta: { proposal_id: proposalId },
  });
}

export async function sendProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_send', action: 'approve' },
    async (tx, audit) => {
      const { raw, hash } = mintShareToken();
      const { clientId } = await sendDraftProposal(
        tx,
        input.id,
        hash,
        shareExpiryFromNow(),
      );
      await recordSentEvent(tx, ctx, input.id, clientId);
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
