// Design-Engagement Machine — the ADMISSION GATE (wave 4, extracted from
// `executor.ts` verbatim). One statement, and the whole concurrency story of an
// advancing edge is in it.
import { designEngagements } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/result';
import type { DesignState } from '../states';
import type { TransitionRun } from './index';

/**
 * Admission gate: only the writer that flips the state off the expected
 * `from` value proceeds — so a side-effect never runs twice for one move. A
 * losing concurrent caller gets `engagement_state_conflict` here. This gate
 * admits ONE racer only on an ADVANCING edge; on a self-loop `def.to` equals
 * the expected state, so both racers match it and the row lock taken by
 * `lockSelfLoop` is what serialises them.
 *
 * THIS STATEMENT IS NOT TO BE RESHAPED, MERGED OR MOVED. `UPDATE … WHERE id = ?
 * AND state = <expected> RETURNING id`, with the row count checked, is what
 * makes a side-effect run at most once. Splitting it into a read and a write, or
 * dropping the `RETURNING`, silently reintroduces the double-fire.
 */
export async function persistGatedStateMove(
  run: TransitionRun,
  fromState: DesignState,
): Promise<void> {
  const gated = await run.tx
    .update(designEngagements)
    .set({ state: run.def.to, updatedAt: new Date() })
    .where(
      and(
        eq(designEngagements.id, run.input.engagementId),
        eq(designEngagements.state, fromState),
      ),
    )
    .returning({ id: designEngagements.id });
  if (!gated[0]) fail('engagement_state_conflict');
}
