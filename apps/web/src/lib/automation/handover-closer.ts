import 'server-only';
// The hourly safety net that closes design-only deliveries whose handover the
// client (or the studio for them) already confirmed (Round C). The staff path
// closes inline (lib/engagements/handover-close.ts); a client's tap on the
// delivery page is closed here, and so is any inline close that failed. No
// claim: closing is idempotent through the executor's state gate, so a second
// tick in the same hour simply finds nothing. No email: the client act already
// notified the studio.
//
// ONE READ PER ORG PER HOUR when there is nothing to close (R1): a single
// statement inside the org's RLS read transaction (which also answers the
// lost-notification sweep's probe, ./lost-act-probe.ts, so that core needs no
// transaction of its own on an idle hour), as the system actor (tenant
// isolation stays with RLS; the explicit org predicate is belt and braces). It
// answers only ids and who confirmed; every close then runs through the executor
// in its own RLS transaction, with its capability and guard checks.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { withOrgContext } from '@/lib/db/context';
import { closeAcknowledgedHandover } from '@/lib/engagements/handover-close';
import { lostActProbeSql, rememberLostActProbe } from './lost-act-probe';
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

interface CloserRead {
  handovers: AcknowledgedHandover[];
  /** The sweep's probe, answered in the same statement. */
  lostActsPossible: boolean;
}

/**
 * This org's deliveries at `design_only_handoff` with a LIVE handover
 * acknowledgement (any channel; not retracted by an `event_correction`) at least
 * `SETTLE_MS` old, the longest-waiting first, and only while the workspace's
 * design (interior) flow is on: a delivery the executor would refuse
 * (`flow_not_enabled`) never takes a place in the window.
 */
async function acknowledgedHandovers(tx: MetraDb, deps: AutomationDeps, settledBy: Date): Promise<CloserRead> {
  const rows = await tx.execute(sql`
    select probe.possible as lost_acts_possible, closable.engagement_id, closable.recorded_by
      from (select ${lostActProbeSql(deps.ctx.userId, deps.now)} as possible) probe
      left join lateral (
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
       where de.org_id = ${deps.ctx.orgId}::uuid
         and de.state = 'design_only_handoff'
         and exists (
           select 1 from public.workspace_entitlements we
            where we.org_id = de.org_id and 'interior' = any (we.enabled_flows))
       order by de.updated_at asc
       limit ${HANDOVER_CLOSES_PER_TICK}) closable on true`);
  const read = rows as unknown as Array<{ lost_acts_possible: boolean; engagement_id: string | null; recorded_by: string }>;
  return {
    lostActsPossible: read[0]?.lost_acts_possible === true,
    handovers: read
      .filter((row) => row.engagement_id !== null)
      .map((row) => ({ engagementId: row.engagement_id as string, recordedBy: row.recorded_by })),
  };
}

export async function runHandoverCloser(deps: AutomationDeps): Promise<AutomationResult> {
  const result: AutomationResult = { automation: 'handover', ran: true, effects: 0, emailsSent: 0, emailsFailed: 0 };
  const settledBy = new Date(deps.now.getTime() - SETTLE_MS);
  const read = await withOrgContext(deps.ctx, (tx) => acknowledgedHandovers(tx, deps, settledBy));
  rememberLostActProbe(deps, read.lostActsPossible);
  for (const handover of read.handovers) {
    const outcome = await closeAcknowledgedHandover(deps.ctx, handover.engagementId, handover.recordedBy);
    if (outcome === 'closed') result.effects += 1;
  }
  return result;
}
