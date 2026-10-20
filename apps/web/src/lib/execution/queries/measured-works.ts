import 'server-only';
// What the measured provisional lines add to the final account, summed in ONE
// SQL aggregate (A3 reliability R3): the delivery card needs one figure, so no
// measured line crosses the wire and its cost does not grow with them.
//
// It mirrors computeFinalAccount (money/final-account.ts) line for line, the
// final account page's per-line rule (A5):
//   - only a PROVISIONAL line is billed by measurement (decision D2a);
//   - its FINAL measured quantity is the latest RECORDED reading (`seq desc`, A12);
//   - residual = measured - contract qty - Σ approved change-order qty on it;
//   - works = round(residual x unit price, 4), less round(that x line discount
//     x 0.01, 4): numeric multiplication is exact, and round() on numeric is
//     half away from zero, the money engine's rule;
//   - the contract's document discount, VAT and supervision follow in TS
//     (finalAccountBalance), on the sum.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

export async function loadMeasuredWorks(tx: MetraDb, contractId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    select coalesce(sum(gross - round(gross * discount_pct * 0.01, 4)), 0)::text as works
      from (
        select l.discount_pct,
               round((latest.measured_qty - l.qty - coalesce(ordered.qty, 0)) * l.unit_price, 4) as gross
          from (
            select distinct on (m.contract_line_id) m.contract_line_id, m.measured_qty
              from public.contract_line_measurements m
             where m.contract_id = ${contractId}
             order by m.contract_line_id, m.seq desc
          ) latest
          join public.contract_lines l on l.id = latest.contract_line_id and l.contract_id = ${contractId}
          left join (
            select vl.contract_line_id, sum(vl.qty) as qty
              from public.variation_order_lines vl
              join public.variation_orders v on v.id = vl.variation_order_id and v.org_id = vl.org_id
             where v.contract_id = ${contractId} and v.status = 'approved' and vl.contract_line_id is not null
             group by vl.contract_line_id
          ) ordered on ordered.contract_line_id = l.id
         where l.provisional
      ) billed
  `)) as unknown as Array<{ works: string }>;
  return rows[0].works;
}
