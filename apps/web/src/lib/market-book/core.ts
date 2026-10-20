// PURE market-book write cores: no next/*, no session. They write ONLY the
// studio's own cost_items (the market tables are SELECT-only to the app), under
// RLS through mutateInOrg, and never change a cost or a price from market data
// after the add: a link is advisory. The 'use server' wrappers in ./actions
// delegate here; exercised directly by *.dbtest.ts.
//
// An add gives the item what the seed would give it (@metra/db/market-seed):
// the seed's names (read from the stored seed book), its studio unit, the
// newest priced month of its whole history as the cost, and cost x 1.05 as the
// selling price unless one is typed. It refuses what the seed skips: an item
// already linked, one with no studio unit, one never priced, and a name the
// studio's own item already has (answered under the name, so another can be typed).
import { costItems } from '@metra/db';
import { atPriceBookScale, withFivePercentMargin } from '@metra/db/market-seed';
import { eq } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { hasCostItemInputShape } from '@/lib/price-book/cost-item-input';
import { COST_ITEM_REFUSALS, requireWritable } from '@/lib/price-book/cost-item-write';
import { isUuid } from '@/lib/uuid';
import { ADD_MARKET_ITEM_OWN_FIELDS, readAddMarketItemInput, type AddMarketItemInput } from './add-input';
import { activeMarketItem, latestPricedMonth, refuseNameClash, refuseWhenAlreadyAdded, seededNames, studioUnitOf } from './market-item-reads';
import { holdStudioBookOrBusy } from './studio-hold';
import { unitsCompatible } from './units';

export type { AddMarketItemInput } from './add-input';

/**
 * Add a market item to the studio's price book as a new cost item linked to
 * it, under the studio's seed lock (so two adds, or an add and a seed, never
 * both create it). Names left blank take the seed's. A taken code answers
 * `code_taken` under `code`.
 */
export async function addMarketItemToPriceBookCore(
  ctx: OrgContext,
  input: AddMarketItemInput,
): Promise<ActionResult & { data?: string }> {
  if (!hasCostItemInputShape(input, ADD_MARKET_ITEM_OWN_FIELDS)) return err('malformed');
  const read = readAddMarketItemInput(input);
  if (!read.ok) return fieldsFailed(read.errors);
  const typed = read.values;
  if (!isUuid(input.marketItemId) || !isUuid(typed.sectionId)) return err('malformed');

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'create', refusals: COST_ITEM_REFUSALS },
    async (tx, audit) => {
      await holdStudioBookOrBusy(tx);
      const item = await activeMarketItem(tx, input.marketItemId);
      await refuseWhenAlreadyAdded(tx, item.id);
      const unit = studioUnitOf(item.unit);
      const priced = await latestPricedMonth(tx, item.id);
      const names = typed.nameAr || typed.nameEn ? { nameAr: typed.nameAr, nameEn: typed.nameEn } : await seededNames(tx, item.id);
      const columns = {
        code: typed.code,
        ...names,
        sectionId: typed.sectionId,
        unit,
        defaultUnitCost: atPriceBookScale(priced.price),
        defaultUnitPrice: typed.defaultUnitPrice ?? withFivePercentMargin(priced.price),
        marketItemId: item.id,
      };
      await requireWritable(tx, columns);
      await refuseNameClash(tx, names);
      const [row] = await tx.insert(costItems).values({ orgId: ctx.orgId, ...columns }).returning({ id: costItems.id });
      await audit({
        entity: 'cost_item',
        entityId: row.id,
        action: 'create',
        before: null,
        after: {
          code: columns.code,
          nameEn: columns.nameEn,
          nameAr: columns.nameAr,
          section_id: columns.sectionId,
          unit,
          default_unit_cost: columns.defaultUnitCost,
          default_unit_price: columns.defaultUnitPrice,
          market_item_id: item.id,
        },
      });
      return row.id;
    },
  );
}

/** A link input as no form can fail to send it: an object, a cost item id, and a market item id or null. Never a throw. */
function isLinkInputShape(input: unknown): input is { costItemId: string; marketItemId: string | null } {
  if (typeof input !== 'object' || input === null) return false;
  const { costItemId, marketItemId } = input as Record<string, unknown>;
  return isUuid(costItemId) && (marketItemId === null || isUuid(marketItemId));
}

/**
 * Link a price-book item to a market item (or unlink it with null). The units
 * must compare; the item's cost and price are never touched.
 */
export async function linkCostItemToMarketCore(
  ctx: OrgContext,
  input: { costItemId: string; marketItemId: string | null },
): Promise<ActionResult> {
  if (!isLinkInputShape(input)) return err('malformed');

  return mutateInOrg(ctx, { capability: 'price_book', action: 'update' }, async (tx, audit) => {
    const before = await requireInOrg(
      tx,
      costItems,
      input.costItemId,
      { id: costItems.id, unit: costItems.unit, marketItemId: costItems.marketItemId },
      'record_not_found',
    );
    if (input.marketItemId !== null) {
      const item = await activeMarketItem(tx, input.marketItemId);
      if (!unitsCompatible(before.unit, item.unit)) fail('market_unit_incompatible');
    }
    if (before.marketItemId === input.marketItemId) return;
    await tx
      .update(costItems)
      .set({ marketItemId: input.marketItemId, updatedAt: new Date() })
      .where(eq(costItems.id, input.costItemId));
    await audit({
      entity: 'cost_item',
      entityId: input.costItemId,
      action: 'update',
      before: { market_item_id: before.marketItemId },
      after: { market_item_id: input.marketItemId },
    });
  });
}
