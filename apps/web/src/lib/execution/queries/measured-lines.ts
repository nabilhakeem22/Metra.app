import 'server-only';
// The measured lines the final account BILLS: provisional lines with a final
// measured quantity (owner decisions D2a and Oct 19). A firm line's difference
// is only flagged, never billed, so the balance does not need it and it is not
// loaded. The latest RECORDED reading wins (`seq desc`, plan A12), found with
// DISTINCT ON in SQL; approved change-order quantity on the line is summed in
// SQL too, so only one row per measured provisional line crosses the wire.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import type { MeasuredLine } from '../money/final-account';

type Row = {
  line_id: string;
  qty: string;
  unit_price: string;
  discount_pct: string;
  measured_qty: string;
  variation_qty: string;
};

export async function loadBilledMeasuredLines(tx: MetraDb, contractId: string): Promise<MeasuredLine[]> {
  const rows = (await tx.execute(sql`
    select l.id as line_id, l.qty::text as qty, l.unit_price::text as unit_price,
           l.discount_pct::text as discount_pct, latest.measured_qty::text as measured_qty,
           coalesce(ordered.qty, 0)::text as variation_qty
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
  `)) as unknown as Row[];
  return rows.map((row) => ({
    lineId: row.line_id,
    qty: row.qty,
    unitPrice: row.unit_price,
    discountPct: row.discount_pct,
    provisional: true,
    measuredQty: row.measured_qty,
    variationQty: row.variation_qty,
  }));
}
