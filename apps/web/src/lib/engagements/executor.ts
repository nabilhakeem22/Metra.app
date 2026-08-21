// Design-Engagement Machine — transition executor (Step 2). This is the ONE and
// ONLY path that moves an engagement's state or appends to the transition ledger.
// No other function may. The state move is an ATOMIC admission gate
// (UPDATE ... WHERE state=<expected> RETURNING, check rowCount) — mirroring
// issueContractCore — so two concurrent callers can never both win. Guards stay
// PURE: this file gathers every fact, then asks the guard engine to decide.
import { designEngagements, engagementTransitions } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import type { PermissionAction } from '@/lib/permissions/roles';
import { generateFeeSchedule } from './fee-schedule';
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
    { capability: def.capability, action: CAPABILITY_ACTION[def.capability] },
    async (tx, audit) => {
      const [engagement] = await tx
        .select()
        .from(designEngagements)
        .where(eq(designEngagements.id, engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');

      const legalFrom = Array.isArray(def.from) ? def.from : [def.from];
      if (!legalFrom.includes(engagement.state)) fail('illegal_trigger');

      const facts: GuardFacts = { engagement };
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
