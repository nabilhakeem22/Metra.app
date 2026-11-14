// The history a bulk price change leaves, inside bulkUpdatePricesCore's
// transaction: one price_changes header and one price_change_lines row per
// touched item (append-only).
import { priceChangeLines, priceChanges, type MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';
import type { BulkRow } from './bulk-apply';
import type { PriceTarget } from './bulk-core';

/** What one bulk change did, as its history records it. */
interface PriceChangeEntry {
  categorySnapshot: string;
  pct: string;
  target: PriceTarget;
  effectiveDate: string;
  updated: BulkRow[];
}

/** Inserts the change's header, then one line per touched item when there are any; answers the header row. */
export async function recordPriceChange(
  tx: MetraDb,
  ctx: OrgContext,
  change: PriceChangeEntry,
): Promise<{ id: string }> {
  const { categorySnapshot, pct, target, effectiveDate, updated } = change;
  const [header] = await tx
    .insert(priceChanges)
    .values({
      orgId: ctx.orgId,
      category: categorySnapshot,
      pctChange: pct,
      target,
      effectiveDate,
      appliedBy: ctx.userId,
      itemCount: updated.length,
    })
    .returning({ id: priceChanges.id });

  if (updated.length > 0) {
    await tx.insert(priceChangeLines).values(
      updated.map((r) => ({
        orgId: ctx.orgId,
        priceChangeId: header.id,
        costItemId: r.id,
        oldUnitCost: r.old_cost,
        newUnitCost: r.new_cost,
        oldUnitPrice: r.old_price,
        newUnitPrice: r.new_price,
      })),
    );
  }
  return header;
}
