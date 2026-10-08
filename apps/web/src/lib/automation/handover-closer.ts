import 'server-only';
// The hourly safety net that closes design-only deliveries whose handover the
// client (or the studio for them) already confirmed (Round C). The staff path
// closes inline (lib/engagements/handover-close.ts); a client's tap on the
// delivery page is closed here, and so is any inline close that failed. No
// claim: closing is idempotent through the executor's state gate, so a second
// tick in the same hour simply finds nothing. No email: the client act already
// notified the studio.
import { designEngagements, engagementEvents, type MetraDb } from '@metra/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { withOrgContext } from '@/lib/db/context';
import { closeAcknowledgedHandover } from '@/lib/engagements/handover-close';
import type { AutomationDeps, AutomationResult } from './types';

/** Deliveries closed per org per tick at most (A12). */
export const HANDOVER_CLOSES_PER_TICK = 50;
/** An acknowledgement this fresh is left to its own request's inline close. */
const SETTLE_MS = 2 * 60 * 1000;

/**
 * Deliveries at `design_only_handoff` with a LIVE handover acknowledgement (any
 * channel; not retracted by an `event_correction`) at least `SETTLE_MS` old,
 * the longest-waiting first.
 */
async function acknowledgedHandovers(tx: MetraDb, settledBy: Date): Promise<string[]> {
  const rows = await tx
    .select({ id: designEngagements.id })
    .from(designEngagements)
    .where(
      and(
        eq(designEngagements.state, 'design_only_handoff'),
        sql`exists (
          select 1 from ${engagementEvents} ack
           where ack.engagement_id = ${designEngagements.id}
             and ack.org_id = ${designEngagements.orgId}
             and ack.kind = 'handoff_acknowledgement'
             and ack.decided_at <= ${settledBy.toISOString()}::timestamptz
             and not exists (
               select 1 from ${engagementEvents} fix
                where fix.org_id = ack.org_id
                  and fix.supersedes_event_id = ack.id
                  and fix.kind = 'event_correction'))`,
      ),
    )
    .orderBy(asc(designEngagements.updatedAt))
    .limit(HANDOVER_CLOSES_PER_TICK);
  return rows.map((row) => row.id);
}

export async function runHandoverCloser(deps: AutomationDeps): Promise<AutomationResult> {
  const result: AutomationResult = { automation: 'handover', ran: true, effects: 0, emailsSent: 0, emailsFailed: 0 };
  const settledBy = new Date(deps.now.getTime() - SETTLE_MS);
  const ids = await withOrgContext(deps.ctx, (tx) => acknowledgedHandovers(tx, settledBy));
  for (const id of ids) {
    if ((await closeAcknowledgedHandover(deps.ctx, id)) === 'closed') result.effects += 1;
  }
  return result;
}
