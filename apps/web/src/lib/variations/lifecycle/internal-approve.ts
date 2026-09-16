// Internal approval of a variation order: draft->internal_approved. An ATOMIC
// admission gate (UPDATE ... WHERE status=... RETURNING, check rowCount), owner/
// admin only (variations_price). Client approve/reject is the unauthenticated
// token path (app_variation_respond_by_token), never the matrix.
import {
  contracts,
  variationOrderEvents,
  variationOrders,
  type MetraDb,
  type VariationStatus,
} from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { mintShareToken, shareExpiryFromNow } from '@/lib/share/token';
import { canInternalApproveVariation } from '../lifecycle-rules';

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
/**
 * Lock the VO row FOR UPDATE and refuse anything that is not a draft.
 *
 * The serialization point: a concurrent line rewrite also locks this row, so it
 * cannot slip between the sum below and the freeze.
 */
async function lockDraftVariation(
  tx: MetraDb,
  variationOrderId: string,
): Promise<{ status: VariationStatus; contractId: string }> {
  const [locked] = await tx
    .select({
      status: variationOrders.status,
      contractId: variationOrders.contractId,
    })
    .from(variationOrders)
    .where(eq(variationOrders.id, variationOrderId))
    .for('update')
    .limit(1);
  if (!locked) fail('invalid');
  if (locked.status !== 'draft') fail('variation_not_draft');
  return locked;
}

/**
 * Freeze net_delta and flip draft -> internal_approved, IN ONE STATEMENT.
 *
 * net_delta = Σ line_total computed inside the UPDATE, so the read of the lines,
 * the freeze of the total and the status flip are atomic and a line rewrite can
 * never interleave between them. Equivalent to computeVariationNetDelta (both sum
 * line_total) and exact in SQL.
 */
async function freezeAndApprove(
  tx: MetraDb,
  variationOrderId: string,
  tokenHash: string,
  shareExpiresAt: Date,
): Promise<void> {
  const gated = await tx
    .update(variationOrders)
    .set({
      status: 'internal_approved',
      netDelta: sql`(
        select coalesce(sum(line_total), 0)
        from public.variation_order_lines
        where variation_order_id = ${variationOrderId}
      )`,
      tokenHash,
      shareExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(variationOrders.id, variationOrderId),
        eq(variationOrders.status, 'draft'),
      ),
    )
    .returning({ id: variationOrders.id });
  if (!gated[0]) fail('variation_not_draft');
}

/**
 * The contract must still be live.
 *
 * A VO drafted before its contract was terminated must not become approvable
 * afterwards: a dead contract carries no commercial change.
 */
async function assertContractStillLive(
  tx: MetraDb,
  variationStatus: VariationStatus,
  contractId: string,
): Promise<void> {
  const contract = await requireInOrg(
    tx,
    contracts,
    contractId,
    { status: contracts.status },
    'invalid',
  );
  if (!canInternalApproveVariation(variationStatus, contract.status)) {
    fail('contract_not_issued');
  }
}

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
    actorUserId: ctx.userId,
    fromStatus: 'draft',
    toStatus: 'internal_approved',
  });
}

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
