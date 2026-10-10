import 'server-only';
// Is there ANY client act this hour's lost-notification sweep could repair?
// (Round C, C11 fix round F5.) The sweep (./lost-notifications.ts) is a claim
// and a function call in a transaction of its own, about 0.3 s per org per tick
// at a 31 ms round trip, which put the hourly tick over its budget from ~10
// orgs. This one statement answers "nothing to do" for almost every org on
// almost every tick, and it is answered IN the handover closer's own read
// statement (one more column, no extra round trip), so on an hour with nothing lost the sweep
// opens no transaction at all.
//
// THE WITNESS IS THE SYSTEM ACTOR'S OWN FEED. The runner's actor is the org's
// owner (else admin), and both roles are recipients of every client-act
// notification (lib/engagements/client-acts/acts.ts, recipientRolesFor), so an
// act the notifier handled left a `client_responded` row in THAT member's feed,
// for that delivery, key and milestone, created (or bumped) at or after the
// act. RLS lets the actor read its own notifications only, which is all this
// needs. The probe is a SUPERSET of the sweep's own rule (any client act in the
// window, not only each key's newest): it can say "maybe" when the sweep then
// finds nothing, never "nothing" when the sweep would find something.
import type { MetraDb } from '@metra/db';
import { sql, type SQL } from 'drizzle-orm';
import type { AutomationDeps } from './types';

/** The sweep's window (app_notify_lost_client_acts): acts 10 minutes to 48 hours old. */
export const LOST_ACT_LOOKBACK_MS = 48 * 60 * 60 * 1000;
export const LOST_ACT_SETTLE_MS = 10 * 60 * 1000;

export function lostActWindow(now: Date): { since: string; until: string } {
  return {
    since: new Date(now.getTime() - LOST_ACT_LOOKBACK_MS).toISOString(),
    until: new Date(now.getTime() - LOST_ACT_SETTLE_MS).toISOString(),
  };
}

/**
 * The probe as ONE scalar SQL expression (a boolean), so the handover closer can
 * select it in the same statement as its own read: no extra round trip.
 */
export function lostActProbeSql(actorUserId: string, now: Date): SQL {
  const { since, until } = lostActWindow(now);
  return sql`(
    with acts as (
      select e.engagement_id, e.decided_at as at, null::text as milestone,
             case e.kind
               when 'concept_approval' then case when e.chosen_artifact_id is null
                 then 'client_concept_approved' else 'client_concept_chosen' end
               when 'concept_change_request' then 'client_concept_changes_requested'
               when 'design_approval' then 'client_design_approved'
               when 'design_change_request' then 'client_design_changes_requested'
               when 'rom_acknowledgement' then 'client_budget_acknowledged'
               when 'handoff_acknowledgement' then 'client_handover_acknowledged'
             end as body_key
        from public.engagement_events e
       where e.actor_channel = 'client'
         and e.decided_at between ${since}::timestamptz and ${until}::timestamptz
      union all
      select c.engagement_id, c.created_at, c.milestone_kind::text, 'client_payment_claimed'
        from public.client_payment_claims c
       where c.status = 'pending'
         and c.created_at between ${since}::timestamptz and ${until}::timestamptz
      union all
      select m.engagement_id, m.created_at, null, 'client_commented'
        from public.engagement_document_comments m
       where m.author_channel = 'client'
         and m.created_at between ${since}::timestamptz and ${until}::timestamptz
    )
    select exists (
      select 1
        from acts a
        join public.design_engagements de on de.id = a.engagement_id
       where a.body_key is not null
         and de.token_hash is not null
         and (de.share_expires_at is null or de.share_expires_at > now())
         and not exists (
           select 1 from public.notifications n
            where n.recipient_user_id = ${actorUserId}::uuid
              and n.kind = 'client_responded'
              and n.entity_type = 'engagement'
              and n.entity_id = a.engagement_id
              and n.body_key = a.body_key
              and (a.milestone is null or n.params ->> 'milestoneKind' = a.milestone)
              and n.created_at >= a.at)
    ))`;
}

async function anyUnansweredClientAct(tx: MetraDb, actorUserId: string, now: Date): Promise<boolean> {
  const rows = (await tx.execute(sql`select ${lostActProbeSql(actorUserId, now)} as possible`)) as unknown as Array<{
    possible: boolean;
  }>;
  return rows[0]?.possible === true;
}

/** Keep a probe answer another core read, for the sweep to use this tick. */
export function rememberLostActProbe(deps: Pick<AutomationDeps, 'memo'>, possible: boolean): void {
  deps.memo.lostActsPossible ??= Promise.resolve(possible);
}

/**
 * Whether the sweep may have work this tick, read inside `tx` the first time
 * (by whichever core asks first) and shared after. A failed read is forgotten,
 * so the sweep then probes in its own transaction.
 */
export function sharedLostActProbe(deps: Pick<AutomationDeps, 'ctx' | 'now' | 'memo'>, tx: MetraDb): Promise<boolean> {
  if (!deps.memo.lostActsPossible) {
    const probe = anyUnansweredClientAct(tx, deps.ctx.userId, deps.now);
    deps.memo.lostActsPossible = probe;
    probe.catch(() => {
      if (deps.memo.lostActsPossible === probe) delete deps.memo.lostActsPossible;
    });
  }
  return deps.memo.lostActsPossible;
}
