import 'server-only';
// R4, stage fees paid while the stage was held: SQL pieces of the ONE ledger
// statement (`queries.ts`), over the bounded history of `window-sql.ts`.
//
// Nothing logs the guard's refusal, so the RECORD ORDER is the proof:
//   1. the delivery first reached the gate state (a real arrival, not a self loop);
//   2. at that moment the milestone was NOT yet covered: the payments of its
//      kind cleared by then were short of the milestone's required amount
//      (the same rule the guard applies: an `amount` milestone is its value, a
//      `percent` one is that share of the design fee, rounded to the piastre;
//      no milestone, or no fee to price it, holds nothing);
//   3. payments of that kind cleared after the arrival and up to the gate's
//      first exit (`<=`: a confirm and advance can share one now()).
// The money counted is capped at the shortfall at arrival, in payment order, so
// an over payment or an extra installment is never a rescue. Bucket: the exit.
import { sql, type SQL } from 'drizzle-orm';
import { MONEY_GATES } from './money-gates';

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
  gate_entries as (
    select x.engagement_id, x.milestone_kind, x.exit_at, min(t.decided_at) as entry_at
      from gate_exits x
      join money_gates g on g.milestone_kind = x.milestone_kind
      join org_transitions t
        on t.engagement_id = x.engagement_id and t.to_state = g.gate_state
       and t.from_state is distinct from t.to_state and t.decided_at <= x.exit_at
     where x.exit_at >= (select at from window_start)
     group by x.engagement_id, x.milestone_kind, x.exit_at),
  gate_shortfalls as (
    select e.engagement_id, e.milestone_kind, e.entry_at, e.exit_at,
           greatest(0, required.amount - paid.amount) as shortfall
      from gate_entries e
      join public.engagement_milestones m on m.engagement_id = e.engagement_id and m.kind::text = e.milestone_kind::text
      join public.design_engagements d on d.id = e.engagement_id
     cross join lateral (
       select case when m.basis = 'amount' then m.value else round(d.design_fee * m.value / 100, 4) end as amount) required
     cross join lateral (
       select coalesce(sum(p.amount), 0) as amount from public.payment_events p
        where p.engagement_id = e.engagement_id and p.kind = e.milestone_kind and p.cleared_at <= e.entry_at) paid),
  held_payments as (
    select s.engagement_id, s.exit_at, s.shortfall, p.amount,
           sum(p.amount) over (partition by s.engagement_id, s.milestone_kind order by p.cleared_at, p.id) as paid_since_entry
      from gate_shortfalls s
      join org_payments p
        on p.engagement_id = s.engagement_id and p.kind = s.milestone_kind
       and p.cleared_at > s.entry_at and p.cleared_at <= s.exit_at
     where s.shortfall > 0),
  held_fee_facts as (
    select 'r4'::text as risk, engagement_id,
           least(paid_since_entry, shortfall) - least(paid_since_entry - amount, shortfall) as amount,
           exit_at as bucket_at, 0 as followups
      from held_payments
     where paid_since_entry - amount < shortfall)`;
}
