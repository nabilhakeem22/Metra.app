import 'server-only';
// The rescue ledger's ONE statement (Risk & Rescue Ledger v1). Every figure is
// aggregated in Postgres, money included (numeric, returned as text), so no
// money math happens in JavaScript; the answer is at most 52 rows: per risk,
// one row per month plus the window total.
//
// The org's "limit firm figures" flag rides in the SAME statement, because a
// role it narrows out (the accountant) can only be refused once it is known.
// For that role every fact sits behind a one-time filter on the flag (`release`),
// so a refused accountant's figures are never computed, not computed and dropped.
import { sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { RangeMonths } from '../range';
import { rangeStartSql } from '../queries/range-start';
import { changeOrderFacts, heldFeeFacts, ledgerRows, stagesMovedFacts } from './rescue-facts-sql';
import type { RescueLedgerRow } from './types';

export interface RescueLedgerRead {
  /** The org's restrict_firm_dashboard setting, as this statement read it. */
  restrictFirmDashboard: boolean;
  /** Empty when the flag withheld the ledger from the caller. */
  rows: RescueLedgerRow[];
}

interface RawRow extends Omit<RescueLedgerRow, 'risk'> {
  restricted: boolean;
  risk: RescueLedgerRow['risk'] | null;
}

/**
 * The ledger rows for the window, and the org flag that decides whether the
 * caller may have them. `withheldWhenRestricted` is true for a role the flag
 * narrows out: the ledger is then computed only while the flag is off.
 */
export async function loadRescueLedgerRows(
  ctx: OrgContext,
  range: RangeMonths,
  withheldWhenRestricted: boolean,
): Promise<RescueLedgerRead> {
  const raw = (await withOrgContext(ctx, (tx) =>
    tx.execute(sql`
      with window_start as (select ${rangeStartSql(range)} as at),
      ${ledgerRows()},
      ${heldFeeFacts()},
      ${changeOrderFacts()},
      ${stagesMovedFacts()},
      org_flag as (
        select o.restrict_firm_dashboard as restricted from public.organizations o
         where o.id = nullif(current_setting('app.current_org_id', true), '')::uuid),
      release as (
        select not (${withheldWhenRestricted}::boolean and coalesce((select restricted from org_flag), true)) as released),
      facts as (
        select * from held_fee_facts
        union all select * from change_order_facts
        union all select * from stages_moved_facts),
      tagged as (
        select risk, engagement_id, amount, bucket_at, followups from facts
         where (select released from release)
        union all
        select 'collected', engagement_id, amount, bucket_at, followups from facts
         where risk in ('r3', 'r4') and (select released from release)),
      ledger as (
        select risk,
               to_char(date_trunc('month', bucket_at), 'YYYY-MM') as month,
               count(*)::int as events,
               count(distinct engagement_id)::int as deliveries,
               case when risk = 'r2' then null else round(sum(amount), 4)::text end as amount,
               case when risk = 'r2' then sum(followups)::int end as followups
          from tagged
         group by grouping sets ((risk, to_char(date_trunc('month', bucket_at), 'YYYY-MM')), (risk)))
      select f.restricted, l.risk, l.month, l.events, l.deliveries, l.amount, l.followups
        from org_flag f left join ledger l on true
       order by l.risk, l.month nulls first`),
  )) as unknown as RawRow[];

  // No org row through RLS reads as restricted: the narrowest answer.
  const restrictFirmDashboard = raw.length === 0 || raw[0].restricted;
  const rows = raw
    .filter((row): row is RawRow & { risk: RescueLedgerRow['risk'] } => row.risk !== null)
    .map(({ risk, month, events, deliveries, amount, followups }) => ({ risk, month, events, deliveries, amount, followups }));
  return { restrictFirmDashboard, rows };
}
