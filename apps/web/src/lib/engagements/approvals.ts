// Design-Engagement Machine — the append-only engagement approvals ledger: the
// staff approval rows the executor's side-effects write.
//
// Step 7: `recordConceptApproval`, the `selectConcept` side-effect. Executor-only:
// MUST be called with the executor's `tx` so the approval-event insert commits
// ATOMICALLY with the concept_review -> negotiation state move, or not at all. No
// payment is collected here — the Gate-A receipt was recorded into the payment
// ledger beforehand and the `gateAInstallmentCleared` guard verifies it cleared;
// this side-effect only appends the row that witnesses the concept selection.
//
// The client's acknowledgement of the ROM band (Step 12) is a standalone action,
// not a side-effect: ./rom-acknowledgement.ts.
import { engagementEvents, type MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';
import type { OfflineApproval } from './offline-approval';
import { conceptApprovalProvenance, designApprovalProvenance } from './offline-provenance';

/**
 * Append ONE `concept_approval` row to the append-only engagement approvals ledger
 * for `engagementId`. `decidedAt` defaults to now() at the database; `actorUserId`
 * is the internal actor from the request context. `offline` is the approval the
 * client gave the studio directly ("Client approved offline"), else null; it may
 * name the option they chose (./offline-provenance.ts).
 */
export async function recordConceptApproval(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
  offline: OfflineApproval | null,
): Promise<void> {
  await tx.insert(engagementEvents).values({
    orgId: ctx.orgId,
    engagementId,
    kind: 'concept_approval',
    actorUserId: ctx.userId,
    ...(await conceptApprovalProvenance(tx, engagementId, offline)),
  });
}

/**
 * Append ONE `design_approval` row to the append-only engagement approvals ledger
 * for `engagementId` — the `approveDesign` side-effect (Step 14). Executor-only:
 * MUST be called with the executor's `tx` so this witness commits ATOMICALLY with
 * the final_approval -> shop_drawings state move, or not at all. `decidedAt`
 * defaults to now() at the database; `actorUserId` is the internal actor.
 * `offline` as for {@link recordConceptApproval}.
 */
export async function recordDesignApproval(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
  offline: OfflineApproval | null,
): Promise<void> {
  await tx.insert(engagementEvents).values({
    orgId: ctx.orgId,
    engagementId,
    kind: 'design_approval',
    actorUserId: ctx.userId,
    ...designApprovalProvenance(offline),
  });
}
