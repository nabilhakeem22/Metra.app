// The offline approval an approval edge's payload carries, read inside the
// executor's transaction. SERVER-SIDE (it reads the transition ledger); the
// rules themselves are pure (offline-approval.ts, review-round.ts).
import { engagementTransitions, type DesignEngagement, type MetraDb } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import {
  mayRecordOfflineApproval,
  parseOfflineApproval,
  type OfflineApproval,
} from './offline-approval';
import { offlineApprovalBounds, reviewRoundStartedAt } from './review-round';

/** When the delivery last entered concept_review, from its transition ledger. */
async function lastEntryIntoConceptReview(tx: MetraDb, engagementId: string): Promise<Date | null> {
  const [row] = await tx
    .select({ decidedAt: engagementTransitions.decidedAt })
    .from(engagementTransitions)
    .where(
      and(
        eq(engagementTransitions.engagementId, engagementId),
        eq(engagementTransitions.toState, 'concept_review'),
      ),
    )
    .orderBy(desc(engagementTransitions.decidedAt))
    .limit(1);
  return row?.decidedAt ?? null;
}

/**
 * None (the studio's own Advance), or a valid offline approval. A payload from
 * a role that may not stand in for the client is `forbidden` (the action
 * refuses it before any read; this is the second fence for any other caller).
 * A malformed or out-of-bounds one refuses the whole transition with its code,
 * rather than recording an approval without its provenance. `engagement` is the
 * row read before the gate, so its state is the review stage being answered.
 */
export async function readOfflineApproval(input: {
  tx: MetraDb;
  ctx: OrgContext;
  engagement: DesignEngagement;
  payload: unknown;
}): Promise<OfflineApproval | null> {
  const { tx, ctx, engagement, payload } = input;
  if (payload === undefined || payload === null) return null;
  if (!mayRecordOfflineApproval(ctx.role)) fail('forbidden');

  const enteredConceptReviewAt =
    engagement.state === 'concept_review'
      ? await lastEntryIntoConceptReview(tx, engagement.id)
      : null;
  const roundStartedAt = reviewRoundStartedAt({
    state: engagement.state,
    rendersReadyAt: engagement.rendersReadyAt,
    enteredConceptReviewAt,
    createdAt: engagement.createdAt,
  });
  const parsed = parseOfflineApproval(payload, offlineApprovalBounds(roundStartedAt, new Date()));
  if (!parsed.ok) fail(parsed.code);
  return parsed.approval;
}
