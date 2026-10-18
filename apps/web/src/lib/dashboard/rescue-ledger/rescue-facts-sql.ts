import 'server-only';
// The three rescue rules as SQL fragments: each yields one fact per counted
// rescue, (risk, engagement_id, amount, bucket_at, followups). Composed into ONE
// statement by `queries.ts`; every arm reads through the caller's RLS context.
// `window_start` is a CTE the statement declares (`rangeStartSql`).
//
// The org's transitions and payments are read ONCE (`ledgerRows`) and every
// rule joins those, because RLS checks membership per row VISITED: a per-alert
// index probe of the transitions visited each one ten times over (measured,
// 1,492 alerts: 164 ms of a 345 ms statement). The alerts are materialized
// too, so each period key's pattern check and cast run once per alert, not once
// per joined row.
import { sql, type SQL } from 'drizzle-orm';
import { REMINDER_EMAIL_COOLDOWN_MINUTES, REMINDER_EMAIL_FAILED, REMINDER_EMAIL_REQUESTED } from '@/lib/engagements/reminder/cooldown';
import { WEEKLY_KEY as FOLLOWUP_ALERT_KEY } from '@/lib/automation/delivery-followup-writes';
import { MONEY_GATES } from './money-gates';

/** The WhatsApp reminder the studio prepared in Metra (D3: counts as the R2 action). */
const REMINDER_PREPARED = 'prepared';

/** A follow up alert's period key: '{engagement uuid}:{ISO week}'. Checked before the cast. */
const ALERT_PERIOD_KEY = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:';

/** The org's whole transition and payment history, each scanned once. */
export function ledgerRows(): SQL {
  return sql`
  org_transitions as materialized (
    select id, engagement_id, trigger, from_state, to_state, decided_at from public.engagement_transitions),
  org_payments as materialized (
    select id, engagement_id, kind, amount, cleared_at from public.payment_events)`;
}

/**
 * R4, stage fees paid while the stage was held. Nothing logs the guard's
 * refusal, so the RECORD ORDER is the proof: the delivery first reached the
 * gate state, the milestone payment cleared after that, and only then did the
 * gate's trigger first fire. `<=` at the exit because a confirm and advance can
 * share one now(). A delivery with no recorded arrival is skipped (A10).
 */
export function heldFeeFacts(): SQL {
  const gates = JSON.stringify(
    MONEY_GATES.map((gate) => ({ trigger: gate.trigger, gate_state: gate.gateState, milestone_kind: gate.milestoneKind })),
  );
  return sql`
  money_gates as (
    select * from jsonb_to_recordset(${gates}::jsonb)
      as g(trigger text, gate_state public.design_engagement_state, milestone_kind public.payment_event_kind)),
  gate_exits as (
    select t.engagement_id, g.milestone_kind, min(t.decided_at) as exit_at
      from org_transitions t join money_gates g on g.trigger = t.trigger
     group by t.engagement_id, g.milestone_kind),
  gate_holds as (
    select x.engagement_id, x.milestone_kind, x.exit_at, min(t.decided_at) as entry_at
      from gate_exits x
      join money_gates g on g.milestone_kind = x.milestone_kind
      join org_transitions t
        on t.engagement_id = x.engagement_id and t.to_state = g.gate_state
       and t.from_state is distinct from t.to_state and t.decided_at <= x.exit_at
     where x.exit_at >= (select at from window_start)
     group by x.engagement_id, x.milestone_kind, x.exit_at),
  held_fee_facts as (
    select 'r4'::text as risk, p.engagement_id, p.amount, h.exit_at as bucket_at, 0 as followups
      from gate_holds h
      join org_payments p
        on p.engagement_id = h.engagement_id and p.kind = h.milestone_kind
       and p.cleared_at > h.entry_at and p.cleared_at <= h.exit_at)`;
}

/**
 * R3, extra revisions billed and paid. Change order status is not reliable
 * (only confirmConcept settles), so PAYMENTS are counted: over the full history,
 * each revision_co payment counts the increase in
 * least(paid so far, change orders raised by then). The total is therefore
 * capped at what was raised, and a payment before any change order counts 0.
 */
export function changeOrderFacts(): SQL {
  return sql`
  revision_payments as (
    select p.id, p.engagement_id, p.cleared_at,
           sum(p.amount) over (partition by p.engagement_id order by p.cleared_at, p.id) as paid_so_far
      from org_payments p
     where p.kind = 'revision_co'),
  revision_cover as (
    select r.id, r.engagement_id, r.cleared_at,
           least(r.paid_so_far, coalesce((select sum(o.amount) from public.engagement_change_orders o
                                           where o.engagement_id = r.engagement_id and o.raised_at <= r.cleared_at), 0)) as covered
      from revision_payments r),
  revision_counted as (
    select engagement_id, cleared_at,
           covered - coalesce(lag(covered) over (partition by engagement_id order by cleared_at, id), 0) as counted
      from revision_cover),
  change_order_facts as (
    select 'r3'::text as risk, engagement_id, counted as amount, cleared_at as bucket_at, 0 as followups
      from revision_counted
     where counted > 0 and cleared_at >= (select at from window_start))`;
}

/**
 * R2, stages moved after a follow up. Alert: the cron's weekly follow up row.
 * Outcome: the first advancing transition after it (self-loops do not end the
 * chain), unless it abandons or leaves final_approval (that wait belongs to R5,
 * A5). Action: a reminder strictly between the two, 'prepared' or an 'email'
 * that no 'email_failed' followed within the cooldown. One rescue per advance.
 */
export function stagesMovedFacts(): SQL {
  return sql`
  followup_alerts as materialized (
    select a.id, a.created_at,
           case when a.period_key ~* ${ALERT_PERIOD_KEY} then split_part(a.period_key, ':', 1)::uuid end as engagement_id
      from public.automation_run_log a
     where a.automation_key = ${FOLLOWUP_ALERT_KEY} and a.created_at >= (select at from window_start)),
  first_advances as (
    select distinct on (f.id) f.engagement_id, f.created_at as alert_at,
           n.id as advance_id, n.decided_at as advance_at, n.from_state, n.to_state
      from followup_alerts f
      join org_transitions n
        on n.engagement_id = f.engagement_id and n.decided_at > f.created_at
       and n.from_state is distinct from n.to_state
     order by f.id, n.decided_at, n.id),
  acted_chains as (
    select c.advance_id, c.engagement_id, c.advance_at, exists (
             select 1 from public.audit_log r
              where r.entity = 'design_engagement' and r.entity_id = c.engagement_id
                and r.at > c.alert_at and r.at < c.advance_at
                and (r.after ->> 'reminder' = ${REMINDER_PREPARED}
                     or (r.after ->> 'reminder' = ${REMINDER_EMAIL_REQUESTED} and not exists (
                           select 1 from public.audit_log failed
                            where failed.entity = 'design_engagement' and failed.entity_id = c.engagement_id
                              and failed.after ->> 'reminder' = ${REMINDER_EMAIL_FAILED}
                              and failed.at >= r.at
                              and failed.at <= r.at + make_interval(mins => ${REMINDER_EMAIL_COOLDOWN_MINUTES}))))) as acted
      from first_advances c
     where c.to_state is distinct from 'abandoned' and c.from_state is distinct from 'final_approval'),
  stages_moved_facts as (
    select 'r2'::text as risk, engagement_id, null::numeric as amount, max(advance_at) as bucket_at, count(*)::int as followups
      from acted_chains
     group by advance_id, engagement_id
    having bool_or(acted))`;
}
