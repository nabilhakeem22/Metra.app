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
import { designEngagements } from '@metra/db';
import { fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { correctionFieldErrors } from './correction-field-rules';
import { appendEventCorrection, requireRetractableEvent } from './event-correction-ledger';
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
    return err('malformed');
  }
  const reasonErrors = correctionFieldErrors(input);
  if (hasFieldErrors(reasonErrors)) return fieldsFailed(reasonErrors);
  const reason = input.reason.trim();

  return mutateInOrg(
    ctx,
    { capability: 'engagements_issue', action: 'approve', flow: 'interior' },
    async (tx, audit) => {
      const engagement = await requireInOrg(
        tx,
        designEngagements,
        input.engagementId,
        { id: designEngagements.id, state: designEngagements.state },
        'engagement_not_found',
      );
      if (isTerminal(engagement.state)) fail('engagement_not_active');

      const target = await requireRetractableEvent(tx, input.engagementId, input.eventId);
      const correction = { engagementId: input.engagementId, eventId: input.eventId, reason, supersedesKind: target.kind };
      return appendEventCorrection(tx, ctx, correction, audit);
    },
  );
}
