// (issued|signed) -> terminated.
// Each state change is an ATOMIC admission gate (UPDATE ... WHERE status=...
// RETURNING, check rowCount) — never read-then-write — so concurrent callers
// cannot double-apply it.
// Cascades: every variation order still awaiting a decision is rejected in the
// SAME transaction, so no VO can be approved against a contract that is gone.
import { contractEvents, contracts, type MetraDb } from '@metra/db';
import { and, eq, inArray } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { rejectVariationsOnContractTermination } from '@/lib/variations/lifecycle';

/**
 * Flip (issued|signed) -> terminated.
 *
 * The transition IS the admission gate: a concurrent 2nd call finds the status no
 * longer in (issued, signed), affects 0 rows and fails `contract_not_signable`,
 * so the variation cascade below can never run twice.
 */
async function terminateActiveContract(
  tx: MetraDb,
  contractId: string,
): Promise<void> {
  const gated = await tx
    .update(contracts)
    .set({ status: 'terminated', updatedAt: new Date() })
    .where(
      and(
        eq(contracts.id, contractId),
        inArray(contracts.status, ['issued', 'signed']),
      ),
    )
    .returning({ id: contracts.id });
  if (!gated[0]) fail('contract_not_signable');
}

/** The append-only ledger row for the transition. */
async function recordTerminatedEvent(
  tx: MetraDb,
  ctx: OrgContext,
  contractId: string,
): Promise<void> {
  await tx.insert(contractEvents).values({
    orgId: ctx.orgId,
    contractId,
    kind: 'terminated',
    actorUserId: ctx.userId,
    fromStatus: null,
    toStatus: 'terminated',
  });
}

/**
 * Audit each variation the cascade closed out.
 *
 * Separate rows, not one summary: each VO's own `before.status` differed, and an
 * audit trail that says "some variations were rejected" cannot answer which.
 */
async function auditCascadedRejections(
  audit: (entry: AuditEntry) => Promise<void>,
  rejected: Array<{ id: string; fromStatus: string | null }>,
): Promise<void> {
  for (const variation of rejected) {
    await audit({
      entity: 'variation_order',
      entityId: variation.id,
      action: 'update',
      before: { status: variation.fromStatus },
      after: { status: 'rejected' },
    });
  }
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
      await terminateActiveContract(tx, input.id);
      await recordTerminatedEvent(tx, ctx, input.id);
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
      await auditCascadedRejections(audit, rejected);
    },
  );
}
