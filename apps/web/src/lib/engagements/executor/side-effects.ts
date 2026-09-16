// Design-Engagement Machine — the SIDE-EFFECT table (wave 4). This replaces a
// ten-branch `if (def.sideEffect === …)` ladder in the executor. `TransitionDef.
// sideEffect` is `SideEffectKey | null`, so AT MOST ONE ever fired: the ladder
// carried no ordering semantics and nothing is lost by making it a lookup. What
// is gained is the guard engine's own property (guards/registry.ts): a
// `Record<SideEffectKey, …>` means widening the union without writing a handler
// is a TYPE ERROR rather than a silently skipped effect.
import { type DesignEngagement, type MetraDb, designEngagements } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { recordConceptApproval, recordDesignApproval } from '../approvals';
import { insertAsBuiltAttestation } from '../attestations';
import { settleConceptAndLock } from '../concept';
import { generateFeeSchedule } from '../fee-schedule';
import { captureRenderManifest } from '../renders';
import { isRevisionTrigger } from '../revision-allowance';
import { applyRevision, resetRevisionsOnReject } from '../revisions';
import type { SideEffectKey, Trigger } from '../transitions';

/**
 * Everything a side-effect may read. The engagement row is the one loaded
 * BEFORE the gate, which is exactly what the branches this replaces used
 * (`engagement.offPlan`). Every handler runs INSIDE the executor's tx, after the
 * gate, so it commits atomically with the state move; a `fail()` inside one
 * rolls the whole transition back — no state change, no side-effect rows.
 */
export interface SideEffectContext {
  tx: MetraDb;
  ctx: OrgContext;
  engagement: DesignEngagement;
  trigger: Trigger;
  payload: unknown;
}

export type SideEffectHandler = (context: SideEffectContext) => Promise<void>;

/** Keyed by SideEffectKey: a key with no handler does not compile. */
export const SIDE_EFFECTS: Record<SideEffectKey, SideEffectHandler> = {
  generateFeeSchedule: ({ tx, ctx, engagement, payload }) =>
    generateFeeSchedule(tx, ctx, engagement.id, payload),

  // Deposit cleared -> the engagement advances to SURVEY (the state move in the
  // gate). "Activate project" is interpreted minimally here: for an Off-Plan
  // engagement, the as-built drawings become due. We deliberately do NOT reach
  // into the projects module / bump project.status this step. The offPlan test
  // lives INSIDE the handler because a non-Off-Plan deposit must still write
  // nothing — it is part of the effect, not part of the dispatch.
  activateOnDeposit: async ({ tx, engagement }) => {
    if (!engagement.offPlan) return;
    await tx
      .update(designEngagements)
      .set({ asBuiltDue: true, updatedAt: new Date() })
      .where(eq(designEngagements.id, engagement.id));
  },

  // selectConcept (Step 7): the Gate-A installment already cleared (guard), so
  // the concept selection is witnessed by ONE append-only approvals row,
  // committed atomically with the concept_review -> negotiation move.
  recordConceptApproval: ({ tx, ctx, engagement }) =>
    recordConceptApproval(tx, ctx, engagement.id),

  // requestRevision (Step 8, self-loop) / designChangeRaised (the 3D loop):
  // increment the FIRING EDGE's revision counter — the two allowances are
  // independent — and, once that count crosses that edge's free allowance,
  // raise a design-fee change order. Atomic with the transition row: a missing
  // change-order amount `fail()`s and rolls the increment back too. The trigger
  // is re-narrowed here because only the two revision edges carry this
  // side-effect; a future edge wired to it without a counter pair fails CLOSED
  // rather than silently spending the concept allowance.
  applyRevision: async ({ tx, ctx, engagement, trigger, payload }) => {
    if (!isRevisionTrigger(trigger)) fail('illegal_trigger');
    await applyRevision(tx, ctx, engagement, trigger, payload);
  },

  // confirmConcept (Step 9): the `revisionCosSettled` guard proved every raised
  // change order is covered, so settle them all (status -> settled, settled_at
  // = now()) and stamp `concept_locked_at`. Atomic with the negotiation ->
  // design_3d move — a guard failure leaves COs `raised`, the lock null.
  settleConceptAndLock: ({ tx, engagement }) =>
    settleConceptAndLock(tx, engagement.id),

  // rendersReady (Step 11): the `rendersPresent` guard proved at least one
  // approved render exists, so capture the deterministic baseline manifest hash
  // over those renders and stamp `renders_ready_at`. Atomic with the design_3d
  // -> final_approval move — a guard failure leaves both columns null.
  captureRenderManifest: ({ tx, engagement }) =>
    captureRenderManifest(tx, engagement.id),

  // flagAsBuiltVariance (Step 13): the `asBuiltDueOpen` guard proved the
  // as-built drawings are due, so append ONE `as_built_attestation` event with
  // has_variance=true. Atomic with the final_approval -> change_triage move.
  recordAsBuiltVariance: ({ tx, ctx, engagement }) =>
    insertAsBuiltAttestation(tx, ctx, engagement.id, true),

  // attestAsBuiltClean (Step 13): a clean as-built attestation — append ONE
  // `as_built_attestation` event with has_variance=false. Atomic with the move
  // to final_approval (the self-loop OR the change_triage reconciliation).
  recordAsBuiltClean: ({ tx, ctx, engagement }) =>
    insertAsBuiltAttestation(tx, ctx, engagement.id, false),

  // approveDesign (Step 14, Gate B): the ROM ack, as-built reconciliation and
  // Gate-B installment guards have all passed, so witness the design sign-off
  // with ONE append-only `design_approval` event. Atomic with the
  // final_approval -> shop_drawings move.
  recordDesignApproval: ({ tx, ctx, engagement }) =>
    recordDesignApproval(tx, ctx, engagement.id),

  // rejectDesign (Step 14, Gate B): bounce back to negotiation and refill the
  // free-revision allowance (revision_count -> 0, concept_locked_at -> null).
  // Atomic with the final_approval -> negotiation move.
  resetRevisionsOnReject: ({ tx, engagement }) =>
    resetRevisionsOnReject(tx, engagement.id),
};
