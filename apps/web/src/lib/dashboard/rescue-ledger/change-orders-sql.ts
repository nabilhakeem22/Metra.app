import 'server-only';
// R3, extra revisions billed and paid: SQL pieces of the ONE ledger statement
// (`queries.ts`), over the bounded history of `window-sql.ts`.
//
// Change order status is not reliable (only confirmConcept settles), so the
// revision_co PAYMENTS are counted, per delivery in payment order, against the
// change orders raised at or before each one:
//   counted_i = min(amount_i, max(0, raised_by(t_i) - counted before i))
// So a payment never counts for more than itself, a payment made before any
// change order counts 0 (even once one is raised later), and each counted amount
// sits in its own payment's month.
//
// The running sum has a closed form, which is what lets SQL compute it with
// window functions instead of a recursion: with P_i the payments so far and
// C_i the change orders raised by payment i, the counted total so far is
//   S_i = P_i + min(0, min over j <= i of (C_j - P_j)).
import { sql, type SQL } from 'drizzle-orm';

export function changeOrderFacts(): SQL {
  return sql`
  revision_payments as (
    select p.id, p.engagement_id, p.cleared_at,
           sum(p.amount) over paid_order as paid_so_far,
           (select coalesce(sum(o.amount), 0) from public.engagement_change_orders o
             where o.engagement_id = p.engagement_id and o.raised_at <= p.cleared_at
               and o.raised_at >= (select at from history_start)) as raised_so_far
      from org_payments p
     where p.kind = 'revision_co'
    window paid_order as (partition by p.engagement_id order by p.cleared_at, p.id rows between unbounded preceding and current row)),
  revision_cover as (
    select id, engagement_id, cleared_at,
           paid_so_far + least(0, min(raised_so_far - paid_so_far) over paid_order) as counted_so_far
      from revision_payments
    window paid_order as (partition by engagement_id order by cleared_at, id rows between unbounded preceding and current row)),
  revision_counted as (
    select engagement_id, cleared_at,
           counted_so_far - coalesce(lag(counted_so_far) over (partition by engagement_id order by cleared_at, id), 0) as counted
      from revision_cover),
  change_order_facts as (
    select 'r3'::text as risk, engagement_id, counted as amount, cleared_at as bucket_at, 0 as followups
      from revision_counted
     where counted > 0 and cleared_at >= (select at from window_start))`;
}
