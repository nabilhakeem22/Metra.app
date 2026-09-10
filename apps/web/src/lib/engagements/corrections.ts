// Retracting a row from the append-only approvals ledger.
//
// `engagement_events` grants SELECT and INSERT and nothing else — the right
// posture for an evidentiary record, and one this does not relax. So a wrong row
// is not deleted or edited: a NEW row points at it and says so, the way an
// accounting reversal does. The mistake stays visible beside its retraction,
// which is what a reader six months into a dispute actually needs.
//
// `liveEvents` (event-provenance.ts) is the other half: it drops retracted rows
// before the guards ever see them, so a withdrawn acknowledgement stops opening
// the gate it opened. Without that half this is bookkeeping theatre.
import { designEngagements, engagementEvents } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { isTerminal } from './states';

export interface RecordEventCorrectionInput {
  engagementId: string;
  /** The event being retracted. */
  eventId: string;
  /** WHY — required, because a retraction with no reason is not evidence. */
  reason: string;
}

/**
 * Retract one ledger row.
 *
 * Gated on `engagements_issue` / approve, which the §2.2 matrix gives to OWNER
 * and ADMIN only. That is deliberately narrower than the create gate on the
 * acknowledgements themselves: recording what a client said is routine studio
 * work, and unsaying it afterwards is not.
 *
 * Flow: shape-check both ids; open the RLS tx; assert the engagement resolves
 * in-org and is not terminal; assert the target row belongs to THIS engagement
 * (`event_not_found` otherwise — RLS scopes the org, this scopes the parent, so
 * an id from a sibling engagement cannot be retracted from here); refuse to
 * retract a correction, and refuse to retract the same row twice; append one
 * `event_correction` carrying `supersedesEventId` and the reason.
 *
 * The two CHECKs from 0043 make the malformed shapes impossible at the database
 * as well — a pointer only a correction may carry, and one every correction
 * must. Never throws to the client: coded ActionResult only.
 */
export async function recordEventCorrectionCore(
  ctx: OrgContext,
  input: RecordEventCorrectionInput,
): Promise<ActionResult & { data?: string }> {
  if (!isUuid(input.engagementId) || !isUuid(input.eventId)) {
    return err('invalid');
  }
  const reason = input.reason?.trim();
  // A retraction without a stated reason is just a disappearance. The whole
  // point of correcting rather than deleting is that the record explains itself.
  if (!reason) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'engagements_issue', action: 'approve', flow: 'interior' },
    async (tx, audit) => {
      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, input.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      if (isTerminal(engagement.state)) fail('engagement_not_active');

      // Scoped to the PARENT as well as the org: RLS stops a foreign tenant, and
      // this stops a valid id from a sibling engagement being retracted here.
      const [target] = await tx
        .select({
          id: engagementEvents.id,
          kind: engagementEvents.kind,
        })
        .from(engagementEvents)
        .where(
          and(
            eq(engagementEvents.id, input.eventId),
            eq(engagementEvents.engagementId, input.engagementId),
          ),
        )
        .limit(1);
      if (!target) fail('event_not_found');
      // A correction is bookkeeping about the ledger, not an event in it. Letting
      // one be retracted would mean un-retracting the row beneath it by a side
      // effect nobody reading the ledger would expect.
      if (target.kind === 'event_correction') fail('invalid');

      // Retracting twice would write a second correction that changes nothing and
      // muddies the record with a decision that was already taken.
      const [existing] = await tx
        .select({ id: engagementEvents.id })
        .from(engagementEvents)
        .where(eq(engagementEvents.supersedesEventId, input.eventId))
        .limit(1);
      if (existing) fail('already_corrected');

      const [row] = await tx
        .insert(engagementEvents)
        .values({
          orgId: ctx.orgId,
          engagementId: input.engagementId,
          kind: 'event_correction',
          actorUserId: ctx.userId,
          supersedesEventId: input.eventId,
          note: reason,
        })
        .returning({ id: engagementEvents.id });

      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'update',
        before: null,
        after: {
          event_id: row.id,
          kind: 'event_correction',
          supersedes_event_id: input.eventId,
          supersedes_kind: target.kind,
          reason,
        },
      });
      return row.id;
    },
  );
}
