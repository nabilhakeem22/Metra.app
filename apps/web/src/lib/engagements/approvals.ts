// Design-Engagement Machine, Step 7 — the `recordConceptApproval` side-effect of
// `selectConcept`. Executor-only: MUST be called with the executor's `tx` so the
// approval-event insert commits ATOMICALLY with the concept_review -> negotiation
// state move, or not at all. No payment is collected here — the Gate-A receipt was
// recorded into the payment ledger beforehand and the `gateAInstallmentCleared`
// guard verifies it cleared; this side-effect only appends the append-only
// approvals-ledger row that witnesses the concept selection.
import { engagementEvents, type MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';

/**
 * Append ONE `concept_approval` row to the append-only engagement approvals ledger
 * for `engagementId`. `decidedAt` defaults to now() at the database; `actorUserId`
 * is the internal actor from the request context.
 */
export async function recordConceptApproval(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
): Promise<void> {
  await tx.insert(engagementEvents).values({
    orgId: ctx.orgId,
    engagementId,
    kind: 'concept_approval',
    actorUserId: ctx.userId,
  });
}
