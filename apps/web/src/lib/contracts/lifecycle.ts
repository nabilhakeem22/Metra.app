// Contract lifecycle transitions. Each state change is an ATOMIC admission gate
// (UPDATE ... WHERE status=... RETURNING, check rowCount) — never read-then-write
// — so concurrent callers can't double-issue / double-terminate. Client-facing
// acknowledgement (issued->signed) is NOT here: it is the unauthenticated token
// path (app_contract_ack_by_token), never the capability matrix.
import { contractEvents, contracts } from '@metra/db';
import { and, eq, inArray } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { mintShareToken, shareExpiryFromNow } from '@/lib/share/token';
import { rejectVariationsOnContractTermination } from '@/lib/variations/lifecycle';

/**
 * Issue a draft contract: draft->issued, mint the client acknowledgement token,
 * write the event. Owner/admin only (contracts_issue). The transition IS the
 * admission gate — a concurrent 2nd issue finds status<>'draft' -> 0 rows ->
 * contract_not_draft, no 2nd token, no 2nd event. Returns the RAW token; the
 * action wrapper turns it into the public acknowledgement link.
 */
export async function issueContractCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'contracts_issue', action: 'approve' },
    async (tx, audit) => {
      const { raw, hash } = mintShareToken();
      const shareExpiresAt = shareExpiryFromNow();

      const gated = await tx
        .update(contracts)
        .set({
          status: 'issued',
          tokenHash: hash,
          shareExpiresAt,
          updatedAt: new Date(),
        })
        .where(and(eq(contracts.id, input.id), eq(contracts.status, 'draft')))
        .returning({ id: contracts.id });
      if (!gated[0]) fail('contract_not_draft');

      await tx.insert(contractEvents).values({
        orgId: ctx.orgId,
        contractId: input.id,
        kind: 'issued',
        actorUserId: ctx.userId,
        fromStatus: 'draft',
        toStatus: 'issued',
      });

      await audit({
        entity: 'contract',
        entityId: input.id,
        action: 'issue',
        before: { status: 'draft' },
        after: { status: 'issued' },
      });
      return raw;
    },
  );
}

/**
 * Terminate an issued or signed contract: (issued|signed)->terminated. Owner/admin
 * only. The transition IS the admission gate — a concurrent 2nd call finds the
 * status no longer in (issued,signed) -> 0 rows -> contract_not_signable.
 *
 * Cascades: every variation order still awaiting a decision is rejected in the
 * same transaction, so no VO can be approved against a contract that is gone.
 */
export async function terminateContractCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'contracts_issue', action: 'approve' },
    async (tx, audit) => {
      const gated = await tx
        .update(contracts)
        .set({ status: 'terminated', updatedAt: new Date() })
        .where(
          and(
            eq(contracts.id, input.id),
            inArray(contracts.status, ['issued', 'signed']),
          ),
        )
        .returning({ id: contracts.id });
      if (!gated[0]) fail('contract_not_signable');

      await tx.insert(contractEvents).values({
        orgId: ctx.orgId,
        contractId: input.id,
        kind: 'terminated',
        actorUserId: ctx.userId,
        fromStatus: null,
        toStatus: 'terminated',
      });

      await audit({
        entity: 'contract',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { status: 'terminated' },
      });

      // A dead contract carries no commercial change: close out every VO that
      // was still awaiting a decision, in this same transaction.
      const rejected = await rejectVariationsOnContractTermination(
        tx,
        ctx,
        input.id,
      );
      for (const variation of rejected) {
        await audit({
          entity: 'variation_order',
          entityId: variation.id,
          action: 'update',
          before: { status: variation.fromStatus },
          after: { status: 'rejected' },
        });
      }
    },
  );
}
