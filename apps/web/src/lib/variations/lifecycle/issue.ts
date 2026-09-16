// Issuing a variation order to the client: internal_approved->issued. An ATOMIC
// admission gate (UPDATE ... WHERE status=... RETURNING, check rowCount), owner/
// admin only (variations_price).
import {
  contracts,
  variationOrderEvents,
  variationOrders,
  type ContractStatus,
  type MetraDb,
  type VariationStatus,
} from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { canIssueVariation } from '../lifecycle-rules';

/**
 * The VO's status and its contract's, read together.
 *
 * INNER JOIN on (id, org_id): a VO whose contract is invisible under RLS simply
 * does not come back, and `invalid` is the answer rather than a null dereference.
 */
async function loadVariationAndContractStatus(
  tx: MetraDb,
  variationOrderId: string,
): Promise<{ voStatus: VariationStatus; contractStatus: ContractStatus }> {
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
    .where(eq(variationOrders.id, variationOrderId))
    .limit(1);
  if (!row) fail('invalid');
  return row;
}

/**
 * Flip internal_approved -> issued. The transition IS the admission gate: a
 * concurrent 2nd issue affects 0 rows and fails
 * `variation_not_internal_approved`.
 */
async function issueApprovedVariation(
  tx: MetraDb,
  variationOrderId: string,
): Promise<void> {
  const gated = await tx
    .update(variationOrders)
    .set({ status: 'issued', updatedAt: new Date() })
    .where(
      and(
        eq(variationOrders.id, variationOrderId),
        eq(variationOrders.status, 'internal_approved'),
      ),
    )
    .returning({ id: variationOrders.id });
  if (!gated[0]) fail('variation_not_internal_approved');
}

/** The append-only ledger row for the transition. */
async function recordIssuedEvent(
  tx: MetraDb,
  ctx: OrgContext,
  variationOrderId: string,
): Promise<void> {
  await tx.insert(variationOrderEvents).values({
    orgId: ctx.orgId,
    variationOrderId,
    kind: 'issued',
    actorUserId: ctx.userId,
    fromStatus: 'internal_approved',
    toStatus: 'issued',
  });
}

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
      const row = await loadVariationAndContractStatus(tx, input.id);
      if (row.voStatus !== 'internal_approved') {
        fail('variation_not_internal_approved');
      }
      if (!canIssueVariation(row.voStatus, row.contractStatus)) {
        fail('contract_not_issued');
      }
      await issueApprovedVariation(tx, input.id);
      await recordIssuedEvent(tx, ctx, input.id);
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
