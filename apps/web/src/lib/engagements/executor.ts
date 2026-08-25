// Design-Engagement Machine — transition executor (Step 2). This is the ONE and
// ONLY path that moves an engagement's state or appends to the transition ledger.
// No other function may. The state move is an ATOMIC admission gate
// (UPDATE ... WHERE state=<expected> RETURNING, check rowCount) — mirroring
// issueContractCore — so two concurrent callers can never both win. Guards stay
// PURE: this file gathers every fact, then asks the guard engine to decide.
import {
  designEngagements,
  engagementArtifacts,
  engagementChangeOrders,
  engagementEvents,
  engagementMilestones,
  engagementTransitions,
  paymentEvents,
} from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import type { PermissionAction } from '@/lib/permissions/roles';
import { recordConceptApproval, recordDesignApproval } from './approvals';
import { insertAsBuiltAttestation } from './attestations';
import { settleConceptAndLock } from './concept';
import { generateFeeSchedule } from './fee-schedule';
import { captureRenderManifest } from './renders';
import { applyRevision, resetRevisionsOnReject } from './revisions';
import { GUARDS, type GuardFacts } from './guards';
import { TRANSITIONS, type CapabilityKey, type Trigger } from './transitions';

/**
 * The permission action each capability family gates on. Design/finance triggers
 * are `update` moves (owner/admin/PM or accountant progress the work); the issue
 * family mints client-facing artefacts and is `approve`-only (owner/admin), so it
 * must gate on `approve` — `update` isn't granted for `engagements_issue`.
 */
const CAPABILITY_ACTION: Record<CapabilityKey, PermissionAction> = {
  engagements_design: 'update',
  engagements_finance: 'update',
  engagements_issue: 'approve',
};

export interface ExecuteTransitionInput {
  engagementId: string;
  trigger: Trigger;
  payload?: unknown;
}

/**
 * Execute one lifecycle transition. Flow: resolve the trigger's def (unknown ->
 * `illegal_trigger`); gate the def's capability; open the RLS tx; load the
 * engagement (`engagement_not_found` if absent/foreign); assert the current state
 * is a legal `from` (else `illegal_trigger` — no ledger write, no state change);
 * run every guard in order (first failure returns its code); apply the def's
 * side-effect (NONE this step); perform the atomic gated UPDATE (0 rows ->
 * `engagement_state_conflict`); append exactly one `engagement_transitions` row;
 * audit. Never throws to the client — coded ActionResult only.
 */
export async function executeTransition(
  ctx: OrgContext,
  input: ExecuteTransitionInput,
): Promise<ActionResult> {
  const def = TRANSITIONS[input.trigger];
  // Defence for untyped callers (e.g. a future Public API forwarding a string):
  // an unknown trigger has no def and is rejected before any DB work.
  if (!def) return err('illegal_trigger');

  const { engagementId } = input;

  return mutateInOrg(
    ctx,
    {
      capability: def.capability,
      action: CAPABILITY_ACTION[def.capability],
      flow: 'interior',
    },
    async (tx, audit) => {
      const [engagement] = await tx
        .select()
        .from(designEngagements)
        .where(eq(designEngagements.id, engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');

      const legalFrom = Array.isArray(def.from) ? def.from : [def.from];
      if (!legalFrom.includes(engagement.state)) fail('illegal_trigger');

      // Guards are PURE, so the executor pre-loads every fact they read: the
      // engagement row plus (Step 4) the fee-schedule milestones and the
      // append-only payment ledger, (Step 5) the recorded artifacts, and (Step 9)
      // the raised change orders. Loaded inside the tx, before any guard runs.
      const milestones = await tx
        .select()
        .from(engagementMilestones)
        .where(eq(engagementMilestones.engagementId, engagementId));
      const payments = await tx
        .select()
        .from(paymentEvents)
        .where(eq(paymentEvents.engagementId, engagementId));
      const artifacts = await tx
        .select()
        .from(engagementArtifacts)
        .where(eq(engagementArtifacts.engagementId, engagementId));
      const changeOrders = await tx
        .select()
        .from(engagementChangeOrders)
        .where(eq(engagementChangeOrders.engagementId, engagementId));
      const events = await tx
        .select()
        .from(engagementEvents)
        .where(eq(engagementEvents.engagementId, engagementId));

      const facts: GuardFacts = {
        engagement,
        milestones,
        payments,
        artifacts,
        changeOrders,
        events,
      };
      for (const guardKey of def.guards) {
        const verdict = GUARDS[guardKey](facts);
        if (!verdict.ok) fail(verdict.code);
      }

      // Atomic admission gate FIRST: only the writer that flips the state off the
      // expected `from` value proceeds — so a side-effect never runs twice for one
      // move. A losing concurrent caller gets `engagement_state_conflict` here.
      const gated = await tx
        .update(designEngagements)
        .set({ state: def.to, updatedAt: new Date() })
        .where(
          and(
            eq(designEngagements.id, engagementId),
            eq(designEngagements.state, engagement.state),
          ),
        )
        .returning({ id: designEngagements.id });
      if (!gated[0]) fail('engagement_state_conflict');

      // Side-effect: runs INSIDE this tx, after the gate, so it commits atomically
      // with the state move. A `fail()` inside it rolls the whole tx back — no
      // state change, no side-effect rows. Each key has exactly one branch.
      if (def.sideEffect === 'generateFeeSchedule') {
        await generateFeeSchedule(tx, ctx, engagementId, input.payload);
      }
      // Deposit cleared -> the engagement advances to SURVEY (the state move
      // above). "Activate project" is interpreted minimally here: for an Off-Plan
      // engagement, the as-built drawings become due. We deliberately do NOT
      // reach into the projects module / bump project.status this step.
      if (def.sideEffect === 'activateOnDeposit' && engagement.offPlan) {
        await tx
          .update(designEngagements)
          .set({ asBuiltDue: true, updatedAt: new Date() })
          .where(eq(designEngagements.id, engagementId));
      }
      // selectConcept (Step 7): the Gate-A installment already cleared (guard),
      // so the concept selection is witnessed by ONE append-only approvals row,
      // committed atomically with the concept_review -> negotiation move.
      if (def.sideEffect === 'recordConceptApproval') {
        await recordConceptApproval(tx, ctx, engagementId);
      }
      // requestRevision (Step 8, self-loop): increment the revision counter and —
      // once the count crosses the free allowance — raise a design-fee change
      // order. Atomic with the negotiation -> negotiation transition row: a
      // missing change-order amount `fail()`s and rolls the increment back too.
      if (def.sideEffect === 'applyRevision') {
        await applyRevision(tx, ctx, engagement, input.payload);
      }
      // confirmConcept (Step 9): the `revisionCosSettled` guard proved every raised
      // change order is covered, so settle them all (status -> settled, settled_at
      // = now()) and stamp `concept_locked_at`. Atomic with the negotiation ->
      // design_3d move — a guard failure leaves COs `raised`, the lock null.
      if (def.sideEffect === 'settleConceptAndLock') {
        await settleConceptAndLock(tx, engagementId);
      }
      // rendersReady (Step 11): the `rendersPresent` guard proved at least one
      // approved render exists, so capture the deterministic baseline manifest hash
      // over those renders and stamp `renders_ready_at`. Atomic with the design_3d
      // -> final_approval move — a guard failure leaves both columns null.
      if (def.sideEffect === 'captureRenderManifest') {
        await captureRenderManifest(tx, engagementId);
      }
      // flagAsBuiltVariance (Step 13): the `asBuiltDueOpen` guard proved the
      // as-built drawings are due, so append ONE `as_built_attestation` event with
      // has_variance=true. Atomic with the final_approval -> change_triage move.
      if (def.sideEffect === 'recordAsBuiltVariance') {
        await insertAsBuiltAttestation(tx, ctx, engagementId, true);
      }
      // attestAsBuiltClean (Step 13): a clean as-built attestation — append ONE
      // `as_built_attestation` event with has_variance=false. Atomic with the move
      // to final_approval (the self-loop OR the change_triage reconciliation).
      if (def.sideEffect === 'recordAsBuiltClean') {
        await insertAsBuiltAttestation(tx, ctx, engagementId, false);
      }
      // approveDesign (Step 14, Gate B): the ROM ack, as-built reconciliation and
      // Gate-B installment guards have all passed, so witness the design sign-off
      // with ONE append-only `design_approval` event. Atomic with the
      // final_approval -> shop_drawings move.
      if (def.sideEffect === 'recordDesignApproval') {
        await recordDesignApproval(tx, ctx, engagementId);
      }
      // rejectDesign (Step 14, Gate B): bounce back to negotiation and refill the
      // free-revision allowance (revision_count -> 0, concept_locked_at -> null).
      // Atomic with the final_approval -> negotiation move.
      if (def.sideEffect === 'resetRevisionsOnReject') {
        await resetRevisionsOnReject(tx, engagementId);
      }

      await tx.insert(engagementTransitions).values({
        orgId: ctx.orgId,
        engagementId,
        trigger: input.trigger,
        fromState: engagement.state,
        toState: def.to,
        actorUserId: ctx.userId,
      });

      await audit({
        entity: 'design_engagement',
        entityId: engagementId,
        action: 'update',
        before: { state: engagement.state },
        after: { state: def.to },
      });
    },
  );
}
