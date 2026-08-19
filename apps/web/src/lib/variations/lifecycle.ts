// Variation-order lifecycle transitions. Each state change is an ATOMIC admission
// gate (UPDATE ... WHERE status=... RETURNING, check rowCount). Internal approval
// + issue are owner/admin only (variations_price). Client approve/reject is the
// unauthenticated token path (app_variation_respond_by_token), never the matrix.
import { variationOrderEvents, variationOrders } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { mintToken, SHARE_TTL_DAYS } from '@/lib/proposals/core';

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
      // Serialization point: hold the VO row lock across the freeze so a
      // concurrent line rewrite (which also locks this row) can't slip in.
      const [locked] = await tx
        .select({ status: variationOrders.status })
        .from(variationOrders)
        .where(eq(variationOrders.id, input.id))
        .for('update')
        .limit(1);
      if (!locked) fail('invalid');
      if (locked.status !== 'draft') fail('variation_not_draft');

      const { raw, hash } = mintToken();
      const shareExpiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86400_000);

      // net_delta = Σ line_total, computed IN the UPDATE (atomic with the freeze).
      // Equivalent to computeVariationNetDelta (both sum line_total), exact in SQL.
      const gated = await tx
        .update(variationOrders)
        .set({
          status: 'internal_approved',
          netDelta: sql`(
            select coalesce(sum(line_total), 0)
            from public.variation_order_lines
            where variation_order_id = ${input.id}
          )`,
          tokenHash: hash,
          shareExpiresAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(variationOrders.id, input.id),
            eq(variationOrders.status, 'draft'),
          ),
        )
        .returning({ id: variationOrders.id });
      if (!gated[0]) fail('variation_not_draft');

      await tx.insert(variationOrderEvents).values({
        orgId: ctx.orgId,
        variationOrderId: input.id,
        kind: 'internal_approved',
        actorUserId: ctx.userId,
        fromStatus: 'draft',
        toStatus: 'internal_approved',
      });

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

/**
 * Issue to the client: internal_approved->issued (owner/admin, variations_price).
 * A PURE status flip — the token was already minted at internal approval (the
 * last write A2 immutability permits on a non-status column), so this activates it
 * (the SDF exposes only issued/approved/rejected VOs) and writes the event. The
 * transition IS the admission gate — a concurrent 2nd issue finds
 * status<>'internal_approved' -> variation_not_internal_approved.
 */
export async function issueVariationCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'variations_price', action: 'approve' },
    async (tx, audit) => {
      const gated = await tx
        .update(variationOrders)
        .set({ status: 'issued', updatedAt: new Date() })
        .where(
          and(
            eq(variationOrders.id, input.id),
            eq(variationOrders.status, 'internal_approved'),
          ),
        )
        .returning({ id: variationOrders.id });
      if (!gated[0]) fail('variation_not_internal_approved');

      await tx.insert(variationOrderEvents).values({
        orgId: ctx.orgId,
        variationOrderId: input.id,
        kind: 'issued',
        actorUserId: ctx.userId,
        fromStatus: 'internal_approved',
        toStatus: 'issued',
      });

      await audit({
        entity: 'variation_order',
        entityId: input.id,
        action: 'issue',
        before: { status: 'internal_approved' },
        after: { status: 'issued' },
      });
    },
  );
}
