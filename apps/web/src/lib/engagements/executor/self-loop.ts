// Design-Engagement Machine — SELF-LOOP serialisation and replay (wave 4,
// extracted from `executor.ts` verbatim). Both phases run BEFORE any fact is
// read, in this order, and that order is the contract: the lock is taken first
// so the replay question is answered against COMMITTED rows.
import { designEngagements, engagementTransitions } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { isSelfLoop } from './admissibility';
import type { TransitionRun } from './index';

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
export async function lockSelfLoop(run: TransitionRun): Promise<void> {
  if (!isSelfLoop(run.def)) return;
  await run.tx
    .select({ id: designEngagements.id })
    .from(designEngagements)
    .where(eq(designEngagements.id, run.input.engagementId))
    .for('update');
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
export async function hasCommittedAttempt(
  run: TransitionRun,
): Promise<boolean> {
  if (!run.idempotencyKey || !isSelfLoop(run.def)) return false;
  const [row] = await run.tx
    .select({ id: engagementTransitions.id })
    .from(engagementTransitions)
    .where(
      and(
        eq(engagementTransitions.orgId, run.ctx.orgId),
        eq(engagementTransitions.engagementId, run.input.engagementId),
        eq(engagementTransitions.trigger, run.input.trigger),
        eq(engagementTransitions.idempotencyKey, run.idempotencyKey),
      ),
    )
    .limit(1);
  if (row === undefined) return false;
  // One tap and four taps are otherwise indistinguishable afterwards: a
  // replay writes nothing, so without this line the ledger, the audit log
  // and the Worker log all look exactly as they would have if the studio
  // had tapped once. The ENGAGEMENT and the TRIGGER, never the key — the
  // key is the caller's credential for this act and does not belong in a
  // log line anyone can read.
  console.info(
    `engagement transition replayed: ${run.input.engagementId} ${run.input.trigger}`,
  );
  return true;
}
