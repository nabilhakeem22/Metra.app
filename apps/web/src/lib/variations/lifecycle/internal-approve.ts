// Internal approval of a variation order: draft->internal_approved. An ATOMIC
// admission gate (UPDATE ... WHERE status=... RETURNING, check rowCount), owner/
// admin only (variations_price). Client approve/reject is the unauthenticated
// token path (app_variation_respond_by_token), never the matrix.
import { variationOrderEvents, type MetraDb } from '@metra/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { mintShareToken, shareExpiryFromNow } from '@/lib/share/token';
import {
  assertContractStillLive,
  freezeAndApprove,
  lockDraftVariation,
} from './internal-approve-gate';

/** The append-only ledger row for the transition. */
async function recordInternalApprovedEvent(
  tx: MetraDb,
  ctx: OrgContext,
  variationOrderId: string,
): Promise<void> {
  await tx.insert(variationOrderEvents).values({
    orgId: ctx.orgId,
    variationOrderId,
    kind: 'internal_approved',
    // A session action by a member of the studio (0051). Every producer of a
    // variation_order_events row now STATES its channel, so `rejected` can be
    // read back as "the client refused" or "the termination closed it".
    actorChannel: 'staff',
    actorUserId: ctx.userId,
    fromStatus: 'draft',
    toStatus: 'internal_approved',
  });
}

/**
 * Internal approval: draft->internal_approved (owner/admin, variations_price).
 *
 * R1 INVARIANT: the frozen `net_delta` MUST equal the sum of the frozen lines.
 * We (1) take a row lock on the VO first (SELECT ... FOR UPDATE) so a concurrent
 * `saveVariationDraftCore` — which also locks the VO row before rewriting its
 * lines — is serialized against us, then (2) compute `net_delta` as a subquery
 * over the lines INSIDE the gating UPDATE, so the read of the lines, the freeze
 * of the total, and the status flip are one atomic statement. A line rewrite can
 * therefore never interleave between the sum and the freeze. The client token is
 * ALSO minted here — the draft row is still unlocked, so this is the last write
 * that may touch a non-status column; the immutability trigger then permits only
 * the status flip on issue (the SDF keeps the token inert until then).
 * Owner/admin only; a concurrent 2nd call finds status<>'draft' ->
 * variation_not_draft.
 */
export async function internalApproveVariationCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'variations_price', action: 'approve' },
    async (tx, audit) => {
      const locked = await lockDraftVariation(tx, input.id);
      await assertContractStillLive(tx, locked.status, locked.contractId);

      const { raw, hash } = mintShareToken();
      await freezeAndApprove(tx, input.id, hash, shareExpiryFromNow());
      await recordInternalApprovedEvent(tx, ctx, input.id);
      await audit({
        entity: 'variation_order',
        entityId: input.id,
        action: 'update',
        before: { status: 'draft' },
        after: { status: 'internal_approved' },
      });
      // The raw token — inert until issue flips the VO to 'issued', at which point
      // this is the client decision link. Returned here because internal approval
      // is the last write allowed to set a non-status column (A2 immutability).
      return raw;
    },
  );
}
