// The offline approval an approval edge's payload carries, read inside the
// executor's transaction. SERVER-SIDE (it reads the transition ledger); the
// rules themselves are pure (offline-approval.ts, review-round.ts,
// client-review.ts).
import {
  designEngagements,
  engagementEvents,
  engagementTransitions,
  type DesignEngagement,
  type MetraDb,
} from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { currentRoundClientDecision } from './client-review';
import { liveEvents } from './event-provenance';
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
 * Refuse `client_review_answered` when the client has answered the round under
 * review (approved or asked for changes on the portal) since the studio opened
 * the form. Called AFTER the executor's state gate, whose UPDATE holds the
 * delivery's row lock until commit; every portal decision takes the same lock
 * first (app_delivery_respond_by_token, app_delivery_choose_concept_by_token).
 * So a decision either committed before this read, and is seen here, or waits
 * and then finds the state moved (`wrong_state`). Recording "approved offline"
 * over a request for changes the client just made is exactly what this stops.
 */
async function refuseIfClientAnswered(tx: MetraDb, engagement: DesignEngagement): Promise<void> {
  const [locked] = await tx
    .select({ rendersReadyAt: designEngagements.rendersReadyAt })
    .from(designEngagements)
    .where(eq(designEngagements.id, engagement.id))
    .limit(1);
  const events = await tx
    .select({
      id: engagementEvents.id,
      kind: engagementEvents.kind,
      actorChannel: engagementEvents.actorChannel,
      acknowledgedIssueAt: engagementEvents.acknowledgedIssueAt,
      decidedAt: engagementEvents.decidedAt,
      supersedesEventId: engagementEvents.supersedesEventId,
    })
    .from(engagementEvents)
    .where(eq(engagementEvents.engagementId, engagement.id));
  const answer = currentRoundClientDecision({
    state: engagement.state,
    rendersReadyAt: locked?.rendersReadyAt ?? engagement.rendersReadyAt,
    events: liveEvents(events),
  });
  if (answer !== null) fail('client_review_answered');
}

/**
 * None (the studio's own Advance), or a valid offline approval. A payload from
 * a role that may not stand in for the client is `forbidden` (the action
 * refuses it before any read; this is the second fence for any other caller).
 * A malformed or out-of-bounds one refuses the whole transition with its code,
 * rather than recording an approval without its provenance, and so does one
 * the client overtook by answering the review themselves. `engagement` is the
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
  await refuseIfClientAnswered(tx, engagement);
  return parsed.approval;
}
