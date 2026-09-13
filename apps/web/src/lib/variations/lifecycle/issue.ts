// Issuing a variation order to the client: internal_approved->issued. An ATOMIC
// admission gate (UPDATE ... WHERE status=... RETURNING, check rowCount), owner/
// admin only (variations_price).
import { contracts, variationOrderEvents, variationOrders } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { canIssueVariation } from '../lifecycle-rules';

/**
 * Issue to the client: internal_approved->issued (owner/admin, variations_price).
 * A PURE status flip — the token was already minted at internal approval (the
 * last write A2 immutability permits on a non-status column), so this activates it
 * (the SDF exposes only issued/approved/rejected VOs) and writes the event. The
 * transition IS the admission gate — a concurrent 2nd issue finds
 * status<>'internal_approved' -> variation_not_internal_approved. The contract
 * must still be live: terminating it closes the VO out instead.
 */
export async function issueVariationCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'variations_price', action: 'approve' },
    async (tx, audit) => {
      const [row] = await tx
        .select({
          voStatus: variationOrders.status,
          contractStatus: contracts.status,
        })
        .from(variationOrders)
        .innerJoin(
          contracts,
          and(
            eq(contracts.id, variationOrders.contractId),
            eq(contracts.orgId, variationOrders.orgId),
          ),
        )
        .where(eq(variationOrders.id, input.id))
        .limit(1);
      if (!row) fail('invalid');
      if (row.voStatus !== 'internal_approved') {
        fail('variation_not_internal_approved');
      }
      if (!canIssueVariation(row.voStatus, row.contractStatus)) {
        fail('contract_not_issued');
      }

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
