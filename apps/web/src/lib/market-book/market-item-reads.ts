// What the market-book write cores (./core.ts) read of a market item, inside
// the caller's RLS transaction, each a coded refusal when the answer forbids
// the write: the item itself, whether the studio already has it, its studio
// unit, its newest priced month, the names the seed gives it, and whether the
// studio's own items already carry the names it would be saved under.
import { costItems, marketItems, marketSeedBook, type MarketUnit, type MetraDb } from '@metra/db';
import { comparisonForm, isOwnItem } from '@metra/db/market-seed';
import { and, eq, sql } from 'drizzle-orm';
import { failFields, type FieldError } from '@/lib/actions/field-errors';
import { fail } from '@/lib/actions/mutate';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { latestPricedSql } from './effective-sql';
import type { MarketPricedMonth, MarketSeededNames } from './types';
import { studioUnitFor } from './units';

/** The market item, as RLS lets the studio see it (a published bulletin prices it), if the ministry still prices it. */
export async function activeMarketItem(tx: MetraDb, marketItemId: string) {
  const [item] = await tx
    .select({ id: marketItems.id, unit: marketItems.unit, status: marketItems.status })
    .from(marketItems)
    .where(eq(marketItems.id, marketItemId))
    .limit(1);
  if (!item || item.status !== 'active') fail('market_item_not_found');
  return item;
}

/** A second active price-book item for one market item is never created (the seed skips it as already linked). */
export async function refuseWhenAlreadyAdded(tx: MetraDb, marketItemId: string): Promise<void> {
  const [linked] = await tx
    .select({ id: costItems.id })
    .from(costItems)
    .where(and(eq(costItems.marketItemId, marketItemId), eq(costItems.active, true)))
    .limit(1);
  if (linked) fail('market_item_already_added');
}

export function studioUnitOf(unit: MarketUnit) {
  const studioUnit = studioUnitFor(unit);
  if (!studioUnit) fail('market_unit_incompatible');
  return studioUnit;
}

/** The newest priced month of the item's whole history, as the page shows it; none is `market_item_unpriced`. */
export async function latestPricedMonth(tx: MetraDb, marketItemId: string): Promise<MarketPricedMonth> {
  const rows = (await tx.execute(sql`
    select to_char(priced.period_month, 'YYYY-MM') as month, priced.price::text as price
      from (${latestPricedSql(sql`${marketItemId}::uuid`)}) priced`)) as unknown as MarketPricedMonth[];
  if (!rows[0]) fail('market_item_unpriced');
  return rows[0];
}

/** The names the seed gives the item (the stored seed book); a book not built yet is `market_book_busy`, as for the seed. */
export async function seededNames(tx: MetraDb, marketItemId: string): Promise<MarketSeededNames> {
  const [names] = await tx
    .select({ nameAr: marketSeedBook.nameAr, nameEn: marketSeedBook.nameEn })
    .from(marketSeedBook)
    .where(eq(marketSeedBook.itemId, marketItemId))
    .limit(1);
  if (!names) fail('market_book_busy');
  return names;
}

/**
 * The seed's name-clash rule (@metra/db/market-seed plan.ts) for an add: a
 * name one of the studio's OWN items already carries (isOwnItem: not linked to
 * a market item, not a seed code), compared in comparisonForm in either
 * language, is refused under that name with the item's code, so the studio can
 * type another one. Where the seed skips the item, the add asks for a name.
 */
export async function refuseNameClash(tx: MetraDb, names: { nameAr: string | null; nameEn: string | null }): Promise<void> {
  const own = (
    await tx.select({ code: costItems.code, nameAr: costItems.nameAr, nameEn: costItems.nameEn, marketItemId: costItems.marketItemId }).from(costItems)
  ).filter(isOwnItem);
  const holderOf = (name: string | null) =>
    name === null ? undefined : own.find((item) => [item.nameAr, item.nameEn].some((held) => held !== null && comparisonForm(held) === comparisonForm(name)));
  const taken = (name: string | null): FieldError | null => {
    const holder = holderOf(name);
    return holder ? { code: 'name_taken', params: { code: holder.code } } : null;
  };
  const errors = collectFieldErrors({ nameAr: taken(names.nameAr), nameEn: taken(names.nameEn) });
  if (Object.keys(errors).length > 0) failFields(errors);
}
