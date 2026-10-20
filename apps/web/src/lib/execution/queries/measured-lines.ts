import 'server-only';
// Every MEASURED line of an execution contract with its FINAL measured
// quantity and what approved change orders ordered on it, as a subquery the
// final account's readers build on (the measured works sum, the differences
// and their counts).
//
// The final measured quantity is the line's latest RECORDED reading (`seq
// desc`, A12), found by ONE probe of the (org_id, contract_line_id, seq desc)
// index per line, a LATERAL as the measurements read takes it (A5
// reliability R3). Sorting every reading of the contract to keep the newest
// per line made the final account's database time grow with the readings
// (191 ms at 200,000); a probe per line keeps it flat in them.
import { sql, type SQL } from 'drizzle-orm';

/** The lines of `contractId` that have a reading, `lines` narrowing them (`l.` is the line). */
export function measuredLinesOf(contractId: string, lines: SQL = sql`true`): SQL {
  return sql`
    select l.id as line_id, l.section_id, l.sort_order as line_sort, l.item_code, l.description_ar,
           l.description_en, l.unit::text as unit, l.qty, l.unit_price, l.discount_pct, l.provisional,
           latest.measured_qty, coalesce(ordered.qty, 0) as variation_qty
      from public.contract_lines l
      join lateral (
        select m.measured_qty from public.contract_line_measurements m
         where m.org_id = l.org_id and m.contract_line_id = l.id
         order by m.seq desc limit 1
      ) latest on true
      left join (
        select vl.contract_line_id, sum(vl.qty) as qty
          from public.variation_order_lines vl
          join public.variation_orders v on v.id = vl.variation_order_id and v.org_id = vl.org_id
         where v.contract_id = ${contractId} and v.status = 'approved' and vl.contract_line_id is not null
         group by vl.contract_line_id
      ) ordered on ordered.contract_line_id = l.id
     where l.contract_id = ${contractId} and ${lines}`;
}

/**
 * Σ over the measured PROVISIONAL lines (decision D2a) of what each line's
 * residual (measured - contract qty - ordered) bills: round(residual x unit
 * price, 4), less round(that x line discount x 0.01, 4), numeric and half away
 * from zero, the money engine's rule (computeFinalAccount, line for line).
 */
export function measuredWorksOf(measuredLines: SQL): SQL {
  return sql`
    select coalesce(sum(gross - round(gross * discount_pct * 0.01, 4)), 0)::text as works
      from (select discount_pct, round((measured_qty - qty - variation_qty) * unit_price, 4) as gross
              from (${measuredLines}) measured
             where provisional) billed`;
}
