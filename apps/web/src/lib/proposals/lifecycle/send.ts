// draft -> sent: mint the share token, open the client's window, tell the feed.
// Each state change is an ATOMIC admission gate (UPDATE ... WHERE status=...
// RETURNING, check rowCount) — never read-then-write — so concurrent callers
// cannot double-apply it.
// Accept/reject metadata lives in the append-only events table, because the row
// locks on send and cannot hold it.
import { proposalEvents, proposals } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { OrgContext } from '@/lib/db/context';
import { mintShareToken, shareExpiryFromNow } from '@/lib/share/token';

export async function sendProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_send', action: 'approve' },
    async (tx, audit) => {
      const { raw, hash } = mintShareToken();
      const shareExpiresAt = shareExpiryFromNow();

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
