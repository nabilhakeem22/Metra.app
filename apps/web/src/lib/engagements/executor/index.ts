// Design-Engagement Machine — transition executor (Step 2). This is the ONE and
// ONLY path that moves an engagement's state or appends to the transition ledger.
// No other function may. ADVANCING edges serialise on the state gate
// (UPDATE ... WHERE state=<expected> RETURNING, check rowCount) — mirroring
// issueContractCore — so two concurrent callers can never both win. SELF-LOOPS
// cannot: their expected state IS their target, so the gate matches for both
// racers and they must serialise on an explicit row lock instead (lockSelfLoop).
// Guards stay PURE, so the READS happen first (facts.ts) and the guard engine
// only decides. This file is the COMPOSITION: `runTransition` below is the
// specification of a state move (./run.ts), one named phase per line, in the
// order the docstring promises and inside the one transaction `mutateInOrg`
// opened. A move that an earlier act already decided goes through
// `executeConsequence` (./consequence.ts) over the same pipeline.
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { TRANSITIONS } from '../transitions';
import { runGatedTransition, type ExecuteTransitionInput } from './run';

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
  return runGatedTransition(ctx, def, input, { ledgerActorUserId: ctx.userId, cause: null });
}
