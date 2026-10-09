import 'server-only';
// The hourly safety net that closes design-only deliveries whose handover the
// client (or the studio for them) already confirmed (Round C). The staff path
// closes inline (lib/engagements/handover-close.ts); a client's tap on the
// delivery page is closed here, and so is any inline close that failed. No
// claim: closing is idempotent through the executor's state gate, so a second
// tick in the same hour simply finds nothing. No email: the client act already
// notified the studio.
//
// ONE READ PER ORG PER HOUR when there is nothing to close (R1): the probe runs
// on the runner's privileged connection, like its other per-tick reads, so it
// opens no RLS transaction. It is scoped to this org explicitly and answers only
// ids and who confirmed; every close then runs through the executor in the org's
// RLS transaction as the system actor, with its capability and guard checks.
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import { closeAcknowledgedHandover } from '@/lib/engagements/handover-close';
import type { AutomationDeps, AutomationResult } from './types';

/** Deliveries closed per org per tick at most (A12). */
export const HANDOVER_CLOSES_PER_TICK = 50;
/** An acknowledgement this fresh is left to its own request's inline close. */
const SETTLE_MS = 2 * 60 * 1000;

interface AcknowledgedHandover {
  engagementId: string;
  /** Who confirmed, for the audit: the member who recorded it, or 'client'. */
  recordedBy: string;
}

/**
 * This org's deliveries at `design_only_handoff` with a LIVE handover
 * acknowledgement (any channel; not retracted by an `event_correction`) at least
 * `SETTLE_MS` old, the longest-waiting first, and only while the workspace's
 * design (interior) flow is on: a delivery the executor would refuse
 * (`flow_not_enabled`) never takes a place in the window.
 */
async function acknowledgedHandovers(orgId: string, settledBy: Date): Promise<AcknowledgedHandover[]> {
  const rows = await withRequestDb((db) =>
    db.execute(sql`
      select de.id as engagement_id,
             case when ack.actor_channel = 'client' or ack.actor_user_id is null
                  then 'client' else ack.actor_user_id::text end as recorded_by
        from public.design_engagements de
        join lateral (
          select a.actor_channel, a.actor_user_id
            from public.engagement_events a
           where a.org_id = de.org_id
             and a.engagement_id = de.id
             and a.kind = 'handoff_acknowledgement'
             and a.decided_at <= ${settledBy.toISOString()}::timestamptz
             and not exists (
               select 1 from public.engagement_events fix
                where fix.org_id = a.org_id
                  and fix.supersedes_event_id = a.id
                  and fix.kind = 'event_correction')
           order by a.decided_at desc
           limit 1) ack on true
       where de.org_id = ${orgId}::uuid
         and de.state = 'design_only_handoff'
         and exists (
           select 1 from public.workspace_entitlements we
            where we.org_id = de.org_id and 'interior' = any (we.enabled_flows))
       order by de.updated_at asc
       limit ${HANDOVER_CLOSES_PER_TICK}`),
  );
  return (rows as unknown as Array<{ engagement_id: string; recorded_by: string }>).map((row) => ({
    engagementId: row.engagement_id,
    recordedBy: row.recorded_by,
  }));
}

export async function runHandoverCloser(deps: AutomationDeps): Promise<AutomationResult> {
  const result: AutomationResult = { automation: 'handover', ran: true, effects: 0, emailsSent: 0, emailsFailed: 0 };
  const settledBy = new Date(deps.now.getTime() - SETTLE_MS);
  for (const handover of await acknowledgedHandovers(deps.ctx.orgId, settledBy)) {
    const outcome = await closeAcknowledgedHandover(deps.ctx, handover.engagementId, handover.recordedBy);
    if (outcome === 'closed') result.effects += 1;
  }
  return result;
}
