// sent -> expired: the window closed without a decision.
// Each state change is an ATOMIC admission gate (UPDATE ... WHERE status=...
// RETURNING, check rowCount) — never read-then-write — so concurrent callers
// cannot double-apply it.
// Reached from the automation runner as well as the studio, so it must stay a
// pure core taking a fabricated OrgContext.
import { proposalEvents, proposals } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

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
