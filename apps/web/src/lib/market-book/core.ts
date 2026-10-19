// PURE market-book write cores: no next/*, no session. They write ONLY the
// studio's own cost_items (the market tables are SELECT-only to the app), under
// RLS through mutateInOrg, and never change a cost or a price from market data
// after the add: a link is advisory. The 'use server' wrappers in ./actions
// delegate here; exercised directly by *.dbtest.ts.
import { costItems, marketItems, type MarketUnit, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { COST_ITEM_REFUSALS, requireWritable } from '@/lib/price-book/cost-item-write';
import { isUuid } from '@/lib/uuid';
import { readAddMarketItemInput, suggestedNames, type AddMarketItemInput } from './add-input';
import { effectiveSql } from './effective-sql';
import { studioUnitFor, unitsCompatible } from './units';

export type { AddMarketItemInput } from './add-input';

/** The market item, as RLS lets the studio see it (a published bulletin prices it), if the ministry still prices it. */
async function activeMarketItem(tx: MetraDb, marketItemId: string) {
  const [item] = await tx
    .select({
      id: marketItems.id,
      key: marketItems.key,
      nameAr: marketItems.nameAr,
      nameEn: marketItems.nameEn,
      specAr: marketItems.specAr,
      specEn: marketItems.specEn,
      unit: marketItems.unit,
      status: marketItems.status,
    })
    .from(marketItems)
    .where(eq(marketItems.id, marketItemId))
    .limit(1);
  if (!item || item.status !== 'active') fail('market_item_not_found');
  return item;
}

/** The newest month whose EFFECTIVE value is a price (a suspended month gives way to the one before): the seed's rule. */
async function latestPricedValue(tx: MetraDb, marketItemId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`
    with effective as (${effectiveSql(sql`(${marketItemId}::uuid)`, null)})
    select price::text as price from effective where status = 'priced' order by period_month desc limit 1`)) as unknown as Array<{ price: string }>;
  return rows[0]?.price ?? null;
}

function studioUnitOf(unit: MarketUnit) {
  const studioUnit = studioUnitFor(unit);
  if (!studioUnit) fail('market_unit_incompatible');
  return studioUnit;
}

/**
 * Add a market item to the studio's price book as a new cost item linked to
 * it: its studio unit, its latest effective priced value as the cost ('0' when
 * it has none), the typed price or else the cost. Names left blank take the
 * item's own with its spec. A taken code answers `code_taken` under `code`.
 */
export async function addMarketItemToPriceBookCore(
  ctx: OrgContext,
  input: AddMarketItemInput,
): Promise<ActionResult & { data?: string }> {
  const read = readAddMarketItemInput(input);
  if (!read.ok) return fieldsFailed(read.errors);
  const typed = read.values;
  if (!isUuid(input.marketItemId) || !isUuid(typed.sectionId)) return err('malformed');

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'create', refusals: COST_ITEM_REFUSALS },
    async (tx, audit) => {
      const item = await activeMarketItem(tx, input.marketItemId);
      const unit = studioUnitOf(item.unit);
      const cost = (await latestPricedValue(tx, item.id)) ?? '0';
      const names = typed.nameAr || typed.nameEn ? { nameAr: typed.nameAr, nameEn: typed.nameEn } : suggestedNames(item);
      const columns = {
        code: typed.code,
        ...names,
        sectionId: typed.sectionId,
        unit,
        defaultUnitCost: cost,
        defaultUnitPrice: typed.defaultUnitPrice ?? cost,
        marketItemId: item.id,
      };
      await requireWritable(tx, columns);
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
          default_unit_cost: cost,
          default_unit_price: columns.defaultUnitPrice,
          market_item_id: item.id,
        },
      });
      return row.id;
    },
  );
}

/**
 * Link a price-book item to a market item (or unlink it with null). The units
 * must compare; the item's cost and price are never touched.
 */
export async function linkCostItemToMarketCore(
  ctx: OrgContext,
  input: { costItemId: string; marketItemId: string | null },
): Promise<ActionResult> {
  if (!isUuid(input.costItemId) || (input.marketItemId !== null && !isUuid(input.marketItemId))) return err('malformed');

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
