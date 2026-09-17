// Design-Engagement Machine — transition executor (Step 2). This is the ONE and
// ONLY path that moves an engagement's state or appends to the transition ledger.
// No other function may. ADVANCING edges serialise on the state gate
// (UPDATE ... WHERE state=<expected> RETURNING, check rowCount) — mirroring
// issueContractCore — so two concurrent callers can never both win. SELF-LOOPS
// cannot: their expected state IS their target, so the gate matches for both
// racers and they must serialise on an explicit row lock instead (lockSelfLoop).
// Guards stay PURE, so the READS happen first (facts.ts) and the guard engine
// only decides. This file is the COMPOSITION: `runTransition` below is the
// specification of a state move, one named phase per line, in the order the
// docstring promises and inside the one transaction `mutateInOrg` opened.
import type { MetraDb } from '@metra/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import {
  CAPABILITY_ACTION,
  TRANSITIONS,
  type TransitionDef,
  type Trigger,
} from '../transitions';
import { validateLegalFrom } from './admissibility';
import { loadEngagementForTransition, loadGuardFacts } from './facts';
import { persistGatedStateMove } from './gate';
import { validateGuards } from './guards-run';
import { auditStateMove, persistTransitionRow } from './ledger';
import { persistClientRelease } from './release';
import { hasCommittedAttempt, lockSelfLoop } from './self-loop';
import { applySideEffect } from './side-effects';

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

/**
 * Everything ONE transition attempt needs, resolved once and passed to every
 * phase as a single object — never seven positional arguments. The `tx` here is
 * the one `mutateInOrg` opened: every phase shares it, so the transaction
 * boundary is the callback's, not any phase's.
 */
export interface TransitionRun {
  tx: MetraDb;
  audit: (entry: AuditEntry) => Promise<void>;
  ctx: OrgContext;
  def: TransitionDef;
  input: ExecuteTransitionInput;
  /** Trimmed + UUID-validated, or null. Stored ONLY on a self-loop ledger row. */
  idempotencyKey: string | null;
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

  return mutateInOrg(
    ctx,
    {
      capability: def.capability,
      action: CAPABILITY_ACTION[def.capability],
      flow: 'interior',
    },
    (tx, audit) => runTransition({ tx, audit, ctx, def, input, idempotencyKey }),
  );
}

/**
 * The transition, phase by phase, inside the ONE transaction `mutateInOrg`
 * opened. THE ORDER IS THE CONTRACT and each phase's own comment says why it
 * stands where it stands. Every phase shares `run.tx`: none of them opens,
 * commits or rolls back anything.
 */
async function runTransition(run: TransitionRun): Promise<void> {
  // LOCK FIRST on a self-loop, THEN read: every fact below must be the
  // committed one, not a snapshot taken while the winner was still running.
  await lockSelfLoop(run);

  // A RETRY OF AN ATTEMPT THAT ALREADY COMMITTED IS A NO-OP. Decided here,
  // before the engagement is even read, so the replay cannot re-run a guard,
  // re-fire a side-effect or append a second ledger row. It returns plain
  // `ok` — the caller asked for this act and this act happened; telling them
  // "already" would only invite them to wonder whether it really did.
  if (await hasCommittedAttempt(run)) return;

  const engagement = await loadEngagementForTransition(run);
  validateLegalFrom(run.def, engagement.state);

  const facts = await loadGuardFacts(run.tx, engagement);
  validateGuards(run.def, facts);

  await persistGatedStateMove(run, engagement.state);
  await applySideEffect(run, engagement);
  await persistClientRelease(run, facts.artifacts);
  await persistTransitionRow(run, engagement.state);
  await auditStateMove(run, engagement.state);
}
