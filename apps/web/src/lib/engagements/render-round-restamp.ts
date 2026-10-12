// A render the studio shows the client while the final design waits for the
// client's answer starts a NEW render round (Round D, A1; owner decision of the
// D3 fix round). The client's design decision names the round it answers
// (renders_ready_at), so a page loaded before the new render answers "changed".
//
// ONLY WHILE THE CLIENT HAS NOT DECIDED. Once an approval or a change request is
// on file for the current round, a render shown later does not cancel it: the
// stamp stays, and the decision keeps counting. The states are the two at
// which the client is asked about the final design (an as-built triage returns
// to final_approval without a new stamp of its own).
//
// THE DATABASE DECIDES, NOT A READ BEFORE IT. Two UPDATEs in the caller's
// transaction (READ COMMITTED):
//  1. a state-conditioned write takes the row lock; Postgres re-checks its
//     state predicate on the newest row version after any lock wait, so a
//     delivery another member moved out of the review meanwhile is left alone;
//  2. with the lock held, a fresh statement sees every client decision
//     committed before it (the decision write takes the same row lock first)
//     and re-stamps only when none is on file for the current round.
// One statement could not do it: a subquery keeps the statement's starting
// snapshot, so a decision committed during the lock wait would be invisible.
import { designEngagements, type MetraDb } from '@metra/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** The states at which the client is asked about the final design. */
const ROUND_UNDER_REVIEW_STATES = ['final_approval', 'change_triage'] as const;

/**
 * A live client design decision on file for the row's CURRENT round: the
 * snapshot's own predicate (app_delivery_by_token, `design_decision`).
 */
const clientDecisionOnFile = sql`exists (
  select 1 from public.engagement_events e
   where e.engagement_id = ${designEngagements.id}
     and e.org_id = ${designEngagements.orgId}
     and e.actor_channel = 'client'
     and e.kind in ('design_approval', 'design_change_request')
     and not exists (
       select 1 from public.engagement_events x
        where x.org_id = e.org_id and x.supersedes_event_id = e.id
     )
     and (
       e.acknowledged_issue_at is not distinct from ${designEngagements.rendersReadyAt}
       or (e.acknowledged_issue_at is null
           and ${designEngagements.rendersReadyAt} is not null
           and e.decided_at >= ${designEngagements.rendersReadyAt})
     )
)`;

/**
 * Re-stamp the render round to the database's now, when the delivery is under
 * review and the client has not decided on the current round. True when it
 * re-stamped. Caller's transaction; RLS scopes both updates to its org.
 */
export async function restampRoundAwaitingDecision(tx: MetraDb, engagementId: string): Promise<boolean> {
  const underReview = and(
    eq(designEngagements.id, engagementId),
    inArray(designEngagements.state, [...ROUND_UNDER_REVIEW_STATES]),
  );
  const locked = await tx
    .update(designEngagements)
    .set({ updatedAt: new Date() })
    .where(underReview)
    .returning({ id: designEngagements.id });
  if (locked.length === 0) return false;
  const restamped = await tx
    .update(designEngagements)
    .set({ rendersReadyAt: sql`now()`, updatedAt: new Date() })
    .where(and(underReview, sql`not ${clientDecisionOnFile}`))
    .returning({ id: designEngagements.id });
  return restamped.length > 0;
}
