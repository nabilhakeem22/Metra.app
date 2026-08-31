// Design-Engagement Machine, Step 8 — the `applyRevision` side-effect shared by
// BOTH revision edges: the `requestRevision` concept self-loop (negotiation ->
// negotiation) and the `designChangeRaised` 3D revision loop (final_approval /
// shop_drawings -> design_3d). ONE mechanism, one commercial rule: N free
// revisions, then a priced change order. Executor-only: MUST be called with the
// executor's `tx` so the revision-counter increment and the optional change-order
// insert commit ATOMICALLY with the transition row, or roll back together. Two
// concerns kept explicitly separate:
//   1) The free-vs-change-order branch is decided from the loaded engagement row
//      (revisionCount / freeRevisionN) — pure arithmetic, no float.
//   2) When the new count crosses the free allowance a change order is DUE: the
//      payload's changeOrderAmount must be a well-formed scale-4 money string > 0
//      (else `fail('revision_co_amount_required')` rolls the whole tx back,
//      counter increment included), and exactly one `raised` change-order row is
//      written with the canonical amount.
import {
  designEngagements,
  engagementChangeOrders,
  type DesignEngagement,
  type MetraDb,
} from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { MONEY_RE, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A well-formed scale-4 money string (rejects comma-decimals, Arabic digits, …). */
function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY_RE.test(value.trim());
}

/**
 * Apply one revision to `engagement`. Increments `revision_count` to `next`; if
 * `next` stays within the free allowance (`freeRevisionN`) it is a FREE revision —
 * the counter moves and NO change order is written (any amount is ignored). If
 * `next` crosses the allowance a change order is DUE: `changeOrderAmount` must be a
 * well-formed scale-4 money string > 0, and exactly one `raised` change-order row
 * is inserted with the canonical amount + optional reason. Must run inside the
 * executor's tx so the increment + optional insert are atomic with the state move.
 */
export async function applyRevision(
  tx: MetraDb,
  ctx: OrgContext,
  engagement: DesignEngagement,
  payload: unknown,
): Promise<void> {
  // Increment ATOMICALLY at the DB (revision_count = revision_count + 1) and read
  // the true post-value back — the executor's state gate does NOT serialize a
  // self-loop (from == to), so two concurrent requestRevision calls both pass the
  // gate; a snapshot read-then-write would lose one increment. The row lock on
  // this UPDATE serializes them, and RETURNING gives each call its real new count.
  const [row] = await tx
    .update(designEngagements)
    .set({
      revisionCount: sql`${designEngagements.revisionCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(designEngagements.id, engagement.id))
    .returning({ revisionCount: designEngagements.revisionCount });
  const next = row.revisionCount;

  // Within the free allowance: increment only, no change order.
  if (next <= engagement.freeRevisionN) return;

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
 * the free-revision allowance (`revision_count` -> 0) and reopens the concept lock
 * (`concept_locked_at` -> null), so the returning engagement gets fresh free
 * revisions. Executor-only: MUST run inside the executor's `tx` so it commits
 * ATOMICALLY with the final_approval -> negotiation state move, or not at all.
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
