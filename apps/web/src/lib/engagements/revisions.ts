// Design-Engagement Machine, Step 8 — the `applyRevision` side-effect shared by
// BOTH revision edges: the `requestRevision` concept self-loop (negotiation ->
// negotiation) and the `designChangeRaised` 3D revision loop (final_approval /
// shop_drawings -> design_3d). ONE mechanism, one commercial rule — N free
// revisions, then a priced change order — but TWO INDEPENDENT allowances: the
// firing trigger picks which counter/allowance pair it spends, so an engagement
// that burned every free concept revision still gets its full free 3D allowance.
// Executor-only: MUST be called with the executor's `tx` so the revision-counter
// increment and the optional change-order insert commit ATOMICALLY with the
// transition row, or roll back together. Three concerns kept explicitly separate:
//   1) WHICH counter the trigger spends — the `REVISION_COUNTERS` lookup below.
//   2) The free-vs-change-order branch, decided from the loaded engagement row
//      (that pair's count / allowance) — pure arithmetic, no float.
//   3) When the new count crosses the free allowance a change order is DUE: the
//      payload's changeOrderAmount must be a well-formed scale-4 money string > 0
//      (else `fail('revision_co_amount_required')` rolls the whole tx back,
//      counter increment included), and exactly one `raised` change-order row is
//      written with the canonical amount. The change-order ROW is identical either
//      way — a CO is a CO, and `revisionCosSettled` aggregates them all.
import {
  designEngagements,
  engagementChangeOrders,
  type DesignEngagement,
  type MetraDb,
} from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { fail } from '@/lib/actions/mutate';
import { MONEY_RE, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import type { RevisionTrigger } from './revision-allowance';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A well-formed scale-4 money string (rejects comma-decimals, Arabic digits, …). */
function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY_RE.test(value.trim());
}

/** Either revision counter column — both are `integer not null`. */
type RevisionCountColumn =
  | typeof designEngagements.revisionCount
  | typeof designEngagements.designRevisionCount;

/**
 * The counter/allowance pair each revision edge spends. ONE function, one lookup —
 * the concept and 3D allowances are independent NUMBERS, not two mechanisms:
 * `requestRevision` moves `revision_count` against `free_revision_n`,
 * `designChangeRaised` moves `design_revision_count` against
 * `free_design_revision_n`. `increment` is a factory so every call gets its own
 * `updatedAt`; the counter itself always moves as a DB-side `+ 1`.
 */
const REVISION_COUNTERS: Record<
  RevisionTrigger,
  {
    counted: RevisionCountColumn;
    increment: (now: Date) => PgUpdateSetSource<typeof designEngagements>;
    allowanceOf: (engagement: DesignEngagement) => number;
  }
> = {
  requestRevision: {
    counted: designEngagements.revisionCount,
    increment: (now) => ({
      revisionCount: sql`${designEngagements.revisionCount} + 1`,
      updatedAt: now,
    }),
    allowanceOf: (engagement) => engagement.freeRevisionN,
  },
  designChangeRaised: {
    counted: designEngagements.designRevisionCount,
    increment: (now) => ({
      designRevisionCount: sql`${designEngagements.designRevisionCount} + 1`,
      updatedAt: now,
    }),
    allowanceOf: (engagement) => engagement.freeDesignRevisionN,
  },
};

/**
 * Apply one revision to `engagement` on the edge `trigger` fired. Increments THAT
 * edge's counter to `next`; if `next` stays within that edge's free allowance it is
 * a FREE revision — the counter moves and NO change order is written (any amount is
 * ignored). If `next` crosses the allowance a change order is DUE:
 * `changeOrderAmount` must be a well-formed scale-4 money string > 0, and exactly
 * one `raised` change-order row is inserted with the canonical amount + optional
 * reason. Must run inside the executor's tx so the increment + optional insert are
 * atomic with the state move.
 */
export async function applyRevision(
  tx: MetraDb,
  ctx: OrgContext,
  engagement: DesignEngagement,
  trigger: RevisionTrigger,
  payload: unknown,
): Promise<void> {
  const counter = REVISION_COUNTERS[trigger];

  // Increment ATOMICALLY at the DB (<counter> = <counter> + 1) and read the true
  // post-value back — the executor's state gate does NOT serialize a self-loop
  // (from == to), so two concurrent requestRevision calls both pass the gate; a
  // snapshot read-then-write would lose one increment. The row lock on this UPDATE
  // serializes them, and RETURNING gives each call its real new count.
  const [row] = await tx
    .update(designEngagements)
    .set(counter.increment(new Date()))
    .where(eq(designEngagements.id, engagement.id))
    .returning({ next: counter.counted });
  const next = row.next;

  // Within THIS edge's free allowance: increment only, no change order.
  if (next <= counter.allowanceOf(engagement)) return;

  // Beyond the free allowance: a change order is due. A missing/malformed/
  // non-positive amount fails the whole transition (the increment rolls back too).
  const changeOrderAmount = isRecord(payload)
    ? payload.changeOrderAmount
    : undefined;
  if (!isMoneyString(changeOrderAmount)) fail('revision_co_amount_required');
  const amount4 = parseMoney4(changeOrderAmount);
  if (amount4 <= 0n) fail('revision_co_amount_required');

  const reason =
    isRecord(payload) && typeof payload.reason === 'string'
      ? payload.reason
      : null;

  await tx.insert(engagementChangeOrders).values({
    orgId: ctx.orgId,
    engagementId: engagement.id,
    amount: formatMoney4(amount4),
    reason,
    status: 'raised',
    raisedByUserId: ctx.userId,
  });
}

/**
 * Reset an engagement's revision bookkeeping when a design is rejected back to
 * negotiation — the `rejectDesign` side-effect (Step 14, owner-locked). Refills
 * the CONCEPT free-revision allowance (`revision_count` -> 0) and reopens the
 * concept lock (`concept_locked_at` -> null), so the returning engagement gets
 * fresh free concept revisions. The 3D allowance (`design_revision_count`) is
 * deliberately NOT refilled: the engagement is going back to concept negotiation,
 * and the 3D revisions already spent stay spent. Executor-only: MUST run inside the
 * executor's `tx` so it commits ATOMICALLY with the final_approval -> negotiation
 * state move, or not at all.
 */
export async function resetRevisionsOnReject(
  tx: MetraDb,
  engagementId: string,
): Promise<void> {
  await tx
    .update(designEngagements)
    .set({ revisionCount: 0, conceptLockedAt: null, updatedAt: new Date() })
    .where(eq(designEngagements.id, engagementId));
}
