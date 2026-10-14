// The one statement a bulk price change runs, inside the caller's transaction.
// The multiply+round happens in SQL (numeric), never in JS float, so a result
// is piastre-exact.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import type { PriceTarget } from './bulk-core';

/** One touched item: its figures before and after the change. */
export interface BulkRow {
  id: string;
  old_cost: string;
  old_price: string;
  new_cost: string;
  new_price: string;
}

/**
 * Apply `round(x * (1 + pct/100), 4)` to every item of the category, to the
 * cost, the price or both, and return old + new per row. The FROM subquery
 * captures the pre-update values in the same statement, so the pair cannot be
 * split by a concurrent write. `pct` is the already-validated decimal STRING:
 * what was checked is exactly what Postgres applies.
 */
export async function applyBulkPercent(
  tx: MetraDb,
  sectionId: string,
  pct: string,
  target: PriceTarget,
): Promise<BulkRow[]> {
  const factor = sql`(1 + ${pct}::numeric / 100)`;
  const touchCost = target === 'cost' || target === 'both';
  const touchPrice = target === 'price' || target === 'both';
  return (await tx.execute(sql`
    update public.cost_items c
    set
      default_unit_cost = ${touchCost ? sql`round(c.default_unit_cost * ${factor}, 4)` : sql`c.default_unit_cost`},
      default_unit_price = ${touchPrice ? sql`round(c.default_unit_price * ${factor}, 4)` : sql`c.default_unit_price`},
      updated_at = now()
    from (
      select id, default_unit_cost as old_cost, default_unit_price as old_price
      from public.cost_items
      where section_id = ${sectionId}
    ) old
    where c.id = old.id
    returning
      c.id as id,
      old.old_cost as old_cost,
      old.old_price as old_price,
      c.default_unit_cost as new_cost,
      c.default_unit_price as new_price
  `)) as unknown as BulkRow[];
}
