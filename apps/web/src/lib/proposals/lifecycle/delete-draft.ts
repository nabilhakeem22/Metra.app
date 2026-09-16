// draft -> gone. The only transition that removes a proposal, and it refuses
// anything that has ever been sent: a sent document is a promise to a client and
// the events table is append-only.
import { proposals } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

export async function deleteDraftProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'update' },
    async (tx, audit) => {
      const proposal = await requireInOrg(
        tx,
        proposals,
        input.id,
        { status: proposals.status },
        'invalid',
      );
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
