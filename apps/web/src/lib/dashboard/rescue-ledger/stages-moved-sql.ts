import 'server-only';
// R2, stages moved after a follow up: SQL pieces of the ONE ledger statement
// (`queries.ts`), over the bounded history of `window-sql.ts`.
//
// Bucketed and windowed on the OUTCOME, the stage move, like R3 and R4: the
// alert and the action may fall before the window start. The order is always
// alert < action < move.
//   Alert: the cron's weekly follow up row, at most ALERT_LOOKBACK_DAYS before the move.
//   Outcome: the first advancing transition after the alert (self loops do not
//     end the chain), unless it abandons or leaves final_approval (that wait
//     belongs to R5, A5). One rescue per move; `followups` counts its alerts.
//   Action, strictly between the alert and the move:
//     - an 'email' reminder that no 'email_failed' followed within the cooldown;
//     - a 'prepared' reminder (the WhatsApp text, D3) that no email attempt
//       followed within the cooldown. The reminder dialog writes 'prepared' when
//       it opens, and its email button lives in the same dialog, so an email
//       sent from it decides on its own and the dialog's row is not the action.
import { sql, type SQL } from 'drizzle-orm';
import { WEEKLY_KEY as FOLLOWUP_ALERT_KEY } from '@/lib/automation/delivery-followup-writes';
import { REMINDER_EMAIL_COOLDOWN_MINUTES, REMINDER_EMAIL_FAILED, REMINDER_EMAIL_REQUESTED } from '@/lib/engagements/reminder/cooldown';
import { ALERT_LOOKBACK_DAYS } from './window-sql';

/** The WhatsApp reminder the studio prepared in Metra. */
const REMINDER_PREPARED = 'prepared';

/** A follow up alert's period key: '{engagement uuid}:{ISO week}'. Checked before the cast. */
const ALERT_PERIOD_KEY = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:';

/** A reminder row of this engagement, of `kind`, within the cooldown after `row`. */
function followedWithinCooldown(row: string, kind: string): SQL {
  return sql`exists (
    select 1 from public.audit_log later
     where later.entity = 'design_engagement' and later.entity_id = ${sql.raw(row)}.entity_id
       and later.after ->> 'reminder' = ${kind}
       and later.at >= ${sql.raw(row)}.at
       and later.at <= ${sql.raw(row)}.at + make_interval(mins => ${REMINDER_EMAIL_COOLDOWN_MINUTES}))`;
}

export function stagesMovedFacts(): SQL {
  return sql`
  followup_alerts as materialized (
    select a.id, a.created_at,
           case when a.period_key ~* ${ALERT_PERIOD_KEY} then split_part(a.period_key, ':', 1)::uuid end as engagement_id
      from public.automation_run_log a
     where a.automation_key = ${FOLLOWUP_ALERT_KEY} and a.created_at >= (select at from alert_start)),
  first_moves as (
    select distinct on (f.id) f.engagement_id, f.created_at as alert_at,
           n.id as move_id, n.decided_at as move_at, n.from_state, n.to_state
      from followup_alerts f
      join org_transitions n
        on n.engagement_id = f.engagement_id and n.decided_at > f.created_at
       and n.from_state is distinct from n.to_state
     order by f.id, n.decided_at, n.id),
  acted_chains as (
    select c.move_id, c.engagement_id, c.move_at, exists (
             select 1 from public.audit_log r
              where r.entity = 'design_engagement' and r.entity_id = c.engagement_id
                and r.at > c.alert_at and r.at < c.move_at
                and ((r.after ->> 'reminder' = ${REMINDER_EMAIL_REQUESTED} and not ${followedWithinCooldown('r', REMINDER_EMAIL_FAILED)})
                  or (r.after ->> 'reminder' = ${REMINDER_PREPARED} and not ${followedWithinCooldown('r', REMINDER_EMAIL_REQUESTED)}))) as acted
      from first_moves c
     where c.move_at >= (select at from window_start)
       and c.alert_at >= c.move_at - make_interval(days => ${ALERT_LOOKBACK_DAYS})
       and c.to_state is distinct from 'abandoned' and c.from_state is distinct from 'final_approval'),
  stages_moved_facts as (
    select 'r2'::text as risk, engagement_id, null::numeric as amount, max(move_at) as bucket_at, count(*)::int as followups
      from acted_chains
     group by move_id, engagement_id
    having bool_or(acted))`;
}
