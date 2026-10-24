import 'server-only';
// What has been billed, paid and claimed on one execution contract, aggregated
// in SQL (plan A25): one statement whatever the number of requests, payments
// or change orders, and only figures cross the wire. Inside the caller's org
// transaction, so RLS scopes every table to the org.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

export interface ContractMoneyFacts {
  pendingClaimCount: number;
  unpaidRequestCount: number;
  /** Issued requests with something still due and no pending "I paid" claim on them. */
  unclaimedDueRequestCount: number;
  openVariationCount: number;
  /** Of the open change orders, the ones issued to the client (the rest are approved internally). */
  issuedVariationCount: number;
  /** Approved change orders that add money and have no issued request. */
  unbilledVariationCount: number;
  /** Σ amount of every ISSUED request (void ones are not billed). */
  issuedRequestsTotal: string;
  approvedVariationNetDeltas: string[];
  /** The schedule rows an issued request already bills. */
  billedMilestoneIds: string[];
  /**
   * The issued final account request: what is still due on it, and the final
   * value it billed up to (itself plus every request issued before it, a
   * request voided after it included, so a void under it reopens the balance).
   */
  finalAccount: { outstanding: string; finalValue: string } | null;
}

type Row = {
  pending_claims: number;
  unpaid_requests: number;
  unclaimed_due_requests: number;
  open_variations: number;
  issued_variations: number;
  unbilled_variations: number;
  issued_total: string;
  approved_deltas: string[];
  billed_milestones: string[];
  final_account: { outstanding: string; final_value: string } | null;
};

export async function loadContractMoneyFacts(tx: MetraDb, contractId: string): Promise<ContractMoneyFacts> {
  const rows = (await tx.execute(sql`
    with req as (
      select r.id, r.kind, r.milestone_id, r.variation_order_id, r.amount, r.status, r.created_at, r.voided_at,
             coalesce((select sum(p.amount) from public.contract_payments p
                        where p.org_id = r.org_id and p.request_id = r.id), 0) as paid
        from public.payment_requests r
       where r.contract_id = ${contractId}
    ), vo as (
      select v.id, v.status, v.net_delta from public.variation_orders v where v.contract_id = ${contractId}
    )
    select
      (select count(*) from public.contract_payment_claims c
        where c.contract_id = ${contractId} and c.status = 'pending')::int as pending_claims,
      (select count(*) from req where status = 'issued' and amount > paid)::int as unpaid_requests,
      (select count(*) from req where status = 'issued' and amount > paid
          and not exists (select 1 from public.contract_payment_claims c
                           where c.contract_id = ${contractId} and c.request_id = req.id and c.status = 'pending'))::int
        as unclaimed_due_requests,
      (select count(*) from vo where status in ('internal_approved', 'issued'))::int as open_variations,
      (select count(*) from vo where status = 'issued')::int as issued_variations,
      (select count(*) from vo
        where status = 'approved' and net_delta > 0
          and not exists (select 1 from req where req.variation_order_id = vo.id and req.status = 'issued'))::int
        as unbilled_variations,
      coalesce((select sum(amount) from req where status = 'issued'), 0)::text as issued_total,
      coalesce((select jsonb_agg(net_delta::text) from vo where status = 'approved'), '[]'::jsonb) as approved_deltas,
      coalesce((select jsonb_agg(milestone_id) from req where status = 'issued' and milestone_id is not null),
               '[]'::jsonb) as billed_milestones,
      (select jsonb_build_object(
                'outstanding', (f.amount - f.paid)::text,
                'final_value', (f.amount + coalesce((
                    select sum(o.amount) from req o
                     where o.kind <> 'final_account' and o.created_at <= f.created_at
                       and (o.status = 'issued' or o.voided_at > f.created_at)), 0))::text)
         from req f where f.kind = 'final_account' and f.status = 'issued' limit 1) as final_account
  `)) as unknown as Row[];
  const row = rows[0];
  return {
    pendingClaimCount: row.pending_claims,
    unpaidRequestCount: row.unpaid_requests,
    unclaimedDueRequestCount: row.unclaimed_due_requests,
    openVariationCount: row.open_variations,
    issuedVariationCount: row.issued_variations,
    unbilledVariationCount: row.unbilled_variations,
    issuedRequestsTotal: row.issued_total,
    approvedVariationNetDeltas: row.approved_deltas,
    billedMilestoneIds: row.billed_milestones,
    finalAccount: row.final_account
      ? { outstanding: row.final_account.outstanding, finalValue: row.final_account.final_value }
      : null,
  };
}
