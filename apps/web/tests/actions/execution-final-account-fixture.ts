// PR A5 DB-test fixture: change orders WITH lines, and readings, by direct SQL.
// Not a test file. A change order's lines are frozen once it leaves draft, so
// they are written while it is one, then it walks to its status. Teardown is
// fixture.ts's.
import { ownerQuery, seedVariation } from './execution-fixture';

export interface OrderLine {
  /** Null for new scope (a line on no contract line). */
  contractLineId: string | null;
  qty: string;
  unitPrice?: string;
  unitCost?: string;
}

/** A change order with `lines` (net delta = Σ qty x price), walked to `status`. */
export async function seedOrderWithLines(
  orgId: string,
  contract: { contractId: string; projectId: string },
  lines: OrderLine[],
  status: 'approved' | 'internal_approved' | 'issued' = 'approved',
): Promise<string> {
  const netDelta = lines.reduce((total, line) => total + Number(line.qty) * Number(line.unitPrice ?? '100'), 0);
  const order = await seedVariation(orgId, contract, 'draft', { netDelta: netDelta.toFixed(4) });
  for (const [index, line] of lines.entries()) {
    await ownerQuery(
      `insert into public.variation_order_lines
         (org_id, variation_order_id, contract_line_id, description_en, qty, unit, unit_cost, unit_price,
          line_cost, line_total, line_margin, sort_order)
       values ($1, $2, $3, 'Changed', $4::numeric, 'sqm', $5::numeric, $6::numeric,
          $4::numeric * $5::numeric, $4::numeric * $6::numeric, $4::numeric * ($6::numeric - $5::numeric), $7)`,
      [orgId, order.id, line.contractLineId, line.qty, line.unitCost ?? '60', line.unitPrice ?? '100', index],
    );
  }
  const path = ['internal_approved', 'issued', 'approved'];
  for (const next of path.slice(0, path.indexOf(status) + 1)) {
    await ownerQuery(`update public.variation_orders set status = $2 where id = $1`, [order.id, next]);
  }
  return order.id;
}

/** A reading straight into the ledger (the connection role). */
export async function seedReading(orgId: string, contractId: string, lineId: string, qty: string, recordedBy: string): Promise<void> {
  await ownerQuery(
    `insert into public.contract_line_measurements (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
     values ($1, $2, $3, $4, current_date, $5)`,
    [orgId, contractId, lineId, qty, recordedBy],
  );
}
