// Design-Engagement Machine — the APPEND-ONLY LEDGER row and the audit entry
// (wave 4, extracted from `executor.ts` verbatim). The last two statements of a
// transition, and the ledger row is load-bearing twice over: it is the history
// AND the idempotency lock.
import { engagementTransitions } from '@metra/db';
import { sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/result';
import type { DesignState } from '../states';
import { isSelfLoop } from './admissibility';
import type { TransitionRun } from './index';

/**
 * The arbiter 0050's partial unique index publishes.
 *
 * For `onConflictDoNothing`, `where` is the ARBITER predicate: it renders
 * ON CONFLICT (org_id, engagement_id, trigger, idempotency_key) WHERE
 * idempotency_key is not null DO NOTHING, matching 0050's partial unique index
 * exactly (targetWhere is a doUpdate-only option).
 */
const REPLAY_ARBITER = {
  target: [
    engagementTransitions.orgId,
    engagementTransitions.engagementId,
    engagementTransitions.trigger,
    engagementTransitions.idempotencyKey,
  ],
  where: sql`idempotency_key is not null`,
};

/**
 * THE LEDGER ROW IS ALSO THE LOCK. The pre-check in `hasCommittedAttempt`
 * closes the ordinary retry; this closes the racing one, where two attempts
 * carrying the same key both pass the pre-check before either commits. ON
 * CONFLICT DO NOTHING (never a raised unique violation, which would abort the
 * surrounding transaction) against the partial arbiter, so the loser writes
 * nothing and — because the whole transition shares this tx — its state move
 * and side-effect roll back with it.
 */
export async function persistTransitionRow(
  run: TransitionRun,
  fromState: DesignState,
): Promise<void> {
  const ledger = await run.tx
    .insert(engagementTransitions)
    .values({
      orgId: run.ctx.orgId,
      engagementId: run.input.engagementId,
      trigger: run.input.trigger,
      fromState,
      toState: run.def.to,
      actorUserId: run.ctx.userId,
      // Self-loops only. On an advancing edge the state gate is the
      // protection, and storing a key there would let one key block a later,
      // legitimately different transition on the same engagement.
      idempotencyKey: isSelfLoop(run.def) ? run.idempotencyKey : null,
    })
    .onConflictDoNothing(REPLAY_ARBITER)
    .returning({ id: engagementTransitions.id });
  if (!ledger[0]) failLostIdempotencyRace(run);
}

/**
 * The RACING retry: two attempts carrying one key both passed the pre-check
 * before either committed, and this is the loser. Its whole transaction rolls
 * back, which is correct and also silent — so say so here, by engagement and
 * trigger, before the rollback takes the row.
 */
function failLostIdempotencyRace(run: TransitionRun): never {
  console.info(
    `engagement transition lost the idempotency race: ${run.input.engagementId} ${run.input.trigger}`,
  );
  fail('engagement_state_conflict');
}

/** The audit entry for the state move, written with the tx's own `audit`. */
export async function auditStateMove(
  run: TransitionRun,
  fromState: DesignState,
): Promise<void> {
  await run.audit({
    entity: 'design_engagement',
    entityId: run.input.engagementId,
    action: 'update',
    before: { state: fromState },
    after: { state: run.def.to },
  });
}
