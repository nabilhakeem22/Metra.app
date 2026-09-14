// Design-Engagement Machine — transition executor (Step 2). This is the ONE and
// ONLY path that moves an engagement's state or appends to the transition ledger.
// No other function may. ADVANCING edges serialise on the state gate
// (UPDATE ... WHERE state=<expected> RETURNING, check rowCount) — mirroring
// issueContractCore — so two concurrent callers can never both win. SELF-LOOPS
// cannot: their expected state IS their target, so the gate matches for both
// racers and they must serialise on an explicit row lock instead (lockSelfLoop).
// Guards stay PURE: this file gathers every fact, then asks the guard engine to
// decide.
import {
  type MetraDb,
  designEngagements,
  engagementArtifacts,
  engagementChangeOrders,
  engagementEvents,
  engagementMilestones,
  engagementTransitions,
  paymentEvents,
} from '@metra/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { recordConceptApproval, recordDesignApproval } from './approvals';
import { CLIENT_RELEASES, selectReleaseArtifactIds } from './client-release';
import { insertAsBuiltAttestation } from './attestations';
import { settleConceptAndLock } from './concept';
import { liveEvents } from './event-provenance';
import { generateFeeSchedule } from './fee-schedule';
import { captureRenderManifest } from './renders';
import { isRevisionTrigger } from './revision-allowance';
import { applyRevision, resetRevisionsOnReject } from './revisions';
import { GUARDS, type GuardFacts } from './guards';
import {
  CAPABILITY_ACTION,
  TRANSITIONS,
  type TransitionDef,
  type Trigger,
} from './transitions';

export interface ExecuteTransitionInput {
  engagementId: string;
  trigger: Trigger;
  payload?: unknown;
  /**
   * The caller's name for ONE ATTEMPT at a SELF-LOOP transition (0050). Honoured
   * only there, because only a self-loop needs it: an advancing edge is already
   * protected by its own state gate, so its retry finds the engagement moved and
   * loses. A self-loop's retry is indistinguishable from a genuine second
   * request, and the one that matters is the UNCERTAIN retry — the write
   * committed and the response was lost on the way back.
   *
   * Must be a UUID when present (malformed is a coded `invalid`, never ignored:
   * silently dropping a key the caller believed in would give false protection).
   */
  idempotencyKey?: string | null;
}

/** A self-loop edge: its target IS one of its legal from-states. */
function isSelfLoop(def: TransitionDef): boolean {
  const from = Array.isArray(def.from) ? def.from : [def.from];
  return from.includes(def.to);
}

/**
 * Has this exact attempt already committed? Answered BEFORE any fact is read, so
 * a replay runs no guard, flips no state, fires no side-effect and writes no
 * ledger row. Runs after lockSelfLoop, so a retry that overlaps the original
 * waits for it to commit and then sees it.
 *
 * THE TRIGGER IS PART OF THE QUESTION. This short-circuit precedes the legal-from
 * check and every guard, so without it a caller that reused one key across two
 * verbs would get plain `ok` for the second with no ledger row, no side-effect
 * and no attestation — a false success on an evidentiary path. A key names one
 * attempt at ONE act; the same key on a different act is a different act.
 */
async function replayedSelfLoop(
  tx: MetraDb,
  ctx: OrgContext,
  def: TransitionDef,
  input: ExecuteTransitionInput,
): Promise<boolean> {
  if (!input.idempotencyKey || !isSelfLoop(def)) return false;
  const [row] = await tx
    .select({ id: engagementTransitions.id })
    .from(engagementTransitions)
    .where(
      and(
        eq(engagementTransitions.orgId, ctx.orgId),
        eq(engagementTransitions.engagementId, input.engagementId),
        eq(engagementTransitions.trigger, input.trigger),
        eq(engagementTransitions.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Serialise the racers on a SELF-LOOP edge, BEFORE any fact is read. The state
 * gate cannot: a self-loop's target IS its expected state, so
 * `UPDATE ... WHERE state = <expected>` matches for every concurrent caller and
 * they all proceed to run the side-effect. Two simultaneous requestRevision calls
 * therefore both incremented the revision count from the same stale read and one
 * free revision was spent twice — or, at the allowance edge, two change orders
 * were raised for one revision.
 *
 * THE ORDER IS THE POINT: this takes the row lock by id and the caller loads the
 * engagement and every guard fact AFTERWARDS, so the second caller waits for the
 * first to commit and then reads the COMMITTED revision count, as-built flag and
 * ledger — not the snapshot it took before queuing. Locking after the load would
 * serialise the writers while leaving both reading the same stale row. No-op on
 * advancing edges, which the gate already serialises.
 */
async function lockSelfLoop(tx: MetraDb, def: TransitionDef, id: string) {
  if (!isSelfLoop(def)) return;
  await tx
    .select({ id: designEngagements.id })
    .from(designEngagements)
    .where(eq(designEngagements.id, id))
    .for('update');
}

/**
 * Every fact the guards read, loaded inside the transaction and AFTER the
 * self-loop lock. Guards are PURE, so the executor pre-loads for them: the
 * engagement row plus (Step 4) the fee-schedule milestones and the append-only
 * payment ledger, (Step 5) the recorded artifacts, and (Step 9) the raised
 * change orders.
 */
async function loadGuardFacts(
  tx: MetraDb,
  engagementId: string,
  engagement: GuardFacts['engagement'],
): Promise<GuardFacts> {
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
  // LIVE events only. A correction cannot delete the row it retracts -- the
  // ledger is INSERT-only by grant -- so the retracted row is still here, and a
  // guard counting it would let a mistake the studio has formally withdrawn go on
  // unlocking the gate it opened.
  const events = liveEvents(
    await tx
      .select()
      .from(engagementEvents)
      .where(eq(engagementEvents.engagementId, engagementId)),
  );
  return { engagement, milestones, payments, artifacts, changeOrders, events };
}

/**
 * Execute one lifecycle transition. Flow: resolve the trigger's def (unknown ->
 * `illegal_trigger`); gate the def's capability; open the RLS tx; take the
 * self-loop row lock; load the engagement (`engagement_not_found` if
 * absent/foreign); assert the current state is a legal `from` (else
 * `illegal_trigger` — no ledger write, no state change);
 * run every guard in order (first failure returns its code); perform the atomic
 * gated UPDATE (0 rows -> `engagement_state_conflict`); apply the def's
 * side-effect and (Client Deliverables, Step 1) its `clientRelease`; append exactly
 * one `engagement_transitions` row; audit. Never throws to the client — coded
 * ActionResult only.
 */
export async function executeTransition(
  ctx: OrgContext,
  input: ExecuteTransitionInput,
): Promise<ActionResult> {
  const def = TRANSITIONS[input.trigger];
  // Defence for untyped callers (e.g. a future Public API forwarding a string):
  // an unknown trigger has no def and is rejected before any DB work.
  if (!def) return err('illegal_trigger');

  // Normalise before any DB work: '' / whitespace reads as absent (a plain
  // transition), and a present-but-malformed key is a coded `invalid` rather
  // than a key quietly dropped on the floor.
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey !== null && !isUuid(idempotencyKey)) return err('invalid');

  const { engagementId } = input;
  const selfLoop = isSelfLoop(def);

  return mutateInOrg(
    ctx,
    {
      capability: def.capability,
      action: CAPABILITY_ACTION[def.capability],
      flow: 'interior',
    },
    async (tx, audit) => {
      // LOCK FIRST on a self-loop, THEN read: every fact below must be the
      // committed one, not a snapshot taken while the winner was still running.
      await lockSelfLoop(tx, def, engagementId);

      // A RETRY OF AN ATTEMPT THAT ALREADY COMMITTED IS A NO-OP. Decided here,
      // before the engagement is even read, so the replay cannot re-run a guard,
      // re-fire a side-effect or append a second ledger row. It returns plain
      // `ok` — the caller asked for this act and this act happened; telling them
      // "already" would only invite them to wonder whether it really did.
      if (await replayedSelfLoop(tx, ctx, def, { ...input, idempotencyKey })) {
        return;
      }

      const [engagement] = await tx
        .select()
        .from(designEngagements)
        .where(eq(designEngagements.id, engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');

      const legalFrom = Array.isArray(def.from) ? def.from : [def.from];
      if (!legalFrom.includes(engagement.state)) fail('illegal_trigger');

      const facts = await loadGuardFacts(tx, engagementId, engagement);
      const { artifacts } = facts;
      for (const guardKey of def.guards) {
        const verdict = GUARDS[guardKey](facts);
        if (!verdict.ok) fail(verdict.code);
      }

      // Admission gate: only the writer that flips the state off the expected
      // `from` value proceeds — so a side-effect never runs twice for one move. A
      // losing concurrent caller gets `engagement_state_conflict` here. This gate
      // admits ONE racer only on an ADVANCING edge; on a self-loop `def.to` equals
      // the expected state, so both racers match it and the row lock taken above
      // is what serialises them.
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
      // requestRevision (Step 8, self-loop) / designChangeRaised (the 3D loop):
      // increment the FIRING EDGE's revision counter — the two allowances are
      // independent — and, once that count crosses that edge's free allowance,
      // raise a design-fee change order. Atomic with the transition row: a missing
      // change-order amount `fail()`s and rolls the increment back too. The trigger
      // is re-narrowed here because only the two revision edges carry this
      // side-effect; a future edge wired to it without a counter pair fails CLOSED
      // rather than silently spending the concept allowance.
      if (def.sideEffect === 'applyRevision') {
        const revisionTrigger = input.trigger;
        if (!isRevisionTrigger(revisionTrigger)) fail('illegal_trigger');
        await applyRevision(tx, ctx, engagement, revisionTrigger, input.payload);
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

      // Client Deliverables (Step 1): auto-share. A release-carrying edge publishes
      // its deliverable package to the tokenized client portal INSIDE this tx, after
      // the atomic gate — so a guard failure (which returns above, before the gate)
      // flips nothing, and a losing concurrent caller shares nothing either. The
      // selector is PURE and reads the `artifacts` already loaded as guard facts, so
      // this costs zero extra reads. Visibility is only ever ADDED; the studio's
      // per-file manual override is the only way to take it back.
      if (def.clientRelease) {
        const releaseIds = selectReleaseArtifactIds(
          CLIENT_RELEASES[def.clientRelease],
          artifacts,
        );
        if (releaseIds.length > 0) {
          await tx
            .update(engagementArtifacts)
            .set({ clientVisible: true, updatedAt: new Date() })
            .where(
              and(
                eq(engagementArtifacts.orgId, ctx.orgId),
                eq(engagementArtifacts.engagementId, engagementId),
                inArray(engagementArtifacts.id, releaseIds),
              ),
            );
        }
      }

      // THE LEDGER ROW IS ALSO THE LOCK. The pre-check above closes the ordinary
      // retry; this closes the racing one, where two attempts carrying the same
      // key both pass the pre-check before either commits. ON CONFLICT DO
      // NOTHING (never a raised unique violation, which would abort the
      // surrounding transaction) against the partial arbiter, so the loser
      // writes nothing and — because the whole transition shares this tx — its
      // state move and side-effect roll back with it.
      const ledger = await tx
        .insert(engagementTransitions)
        .values({
          orgId: ctx.orgId,
          engagementId,
          trigger: input.trigger,
          fromState: engagement.state,
          toState: def.to,
          actorUserId: ctx.userId,
          // Self-loops only. On an advancing edge the state gate is the
          // protection, and storing a key there would let one key block a later,
          // legitimately different transition on the same engagement.
          idempotencyKey: selfLoop ? idempotencyKey : null,
        })
        .onConflictDoNothing({
          // For onConflictDoNothing, `where` is the ARBITER predicate: it renders
          // ON CONFLICT (org_id, engagement_id, trigger, idempotency_key) WHERE
          // idempotency_key is not null DO NOTHING, matching 0050's partial
          // unique index exactly (targetWhere is a doUpdate-only option).
          target: [
            engagementTransitions.orgId,
            engagementTransitions.engagementId,
            engagementTransitions.trigger,
            engagementTransitions.idempotencyKey,
          ],
          where: sql`idempotency_key is not null`,
        })
        .returning({ id: engagementTransitions.id });
      if (!ledger[0]) fail('engagement_state_conflict');

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
