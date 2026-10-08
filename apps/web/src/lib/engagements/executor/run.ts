// Design-Engagement Machine — the shared body of every state move: the per-trigger
// role gate, the capability gate and RLS transaction (`mutateInOrg`), and the
// phases of `runTransition` in their contractual order. Two entry points use it:
// `executeTransition` (./index.ts: a person fires a trigger) and
// `executeConsequence` (./consequence.ts: an act that already decided the move).
// They differ ONLY in who the ledger row names and the audit's `cause`.
import type { MetraDb } from '@metra/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import { NOT_UUID, optionalUuid } from '@/lib/uuid';
import { CAPABILITY_ACTION, roleMayFire, type TransitionDef, type Trigger } from '../transitions';
import { validateLegalFrom } from './admissibility';
import type { TransitionConsequence } from './consequence';
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

/** Who the ledger row names, and why the move happened when no one chose it. */
export interface TransitionAttribution {
  /** The ledger row's `actor_user_id`: the caller, or null when Metra moved it. */
  ledgerActorUserId: string | null;
  /** The act that decided the move (consequence.ts), or null for a person's trigger. */
  cause: TransitionConsequence | null;
}

/**
 * Everything ONE transition attempt needs, resolved once and passed to every
 * phase as a single object — never seven positional arguments. The `tx` here is
 * the one `mutateInOrg` opened: every phase shares it, so the transaction
 * boundary is the callback's, not any phase's.
 */
export interface TransitionRun extends TransitionAttribution {
  tx: MetraDb;
  audit: (entry: AuditEntry) => Promise<void>;
  ctx: OrgContext;
  def: TransitionDef;
  input: ExecuteTransitionInput;
  /** Trimmed + UUID-validated, or null. Stored ONLY on a self-loop ledger row. */
  idempotencyKey: string | null;
}

/**
 * Gate, then run `def` in one RLS transaction. A per-trigger role restriction
 * (the endings: owner/admin/PM only) and a malformed idempotency key are refused
 * before any DB work, then `mutateInOrg` gates the def's capability. Never throws
 * to the caller: a coded ActionResult only.
 */
export async function runGatedTransition(
  ctx: OrgContext,
  def: TransitionDef,
  input: ExecuteTransitionInput,
  attribution: TransitionAttribution,
): Promise<ActionResult> {
  if (!roleMayFire(def, ctx.role)) return err('forbidden');

  // Normalise before any DB work: '' / whitespace reads as absent (a plain
  // transition), and a present-but-malformed key is a coded `invalid` rather
  // than a key quietly dropped on the floor. A present-but-NON-STRING key is
  // `invalid` too rather than a TypeError escaping the action — see optionalUuid.
  const idempotencyKey = optionalUuid(input.idempotencyKey);
  if (idempotencyKey === NOT_UUID) return err('invalid');

  return mutateInOrg(
    ctx,
    {
      capability: def.capability,
      action: CAPABILITY_ACTION[def.capability],
      flow: 'interior',
    },
    (tx, audit) => runTransition({ tx, audit, ctx, def, input, idempotencyKey, ...attribution }),
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
