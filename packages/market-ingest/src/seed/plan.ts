// What seeding one studio's price book from the published market book would
// do, decided purely from the market items and what the studio already has.
// The plan never touches a studio row: an item or section the studio already
// has is left exactly as it is, and a clash is skipped, never overwritten.
import type { CostItemUnit } from '@metra/db/schema';
import { studioUnitFor } from '@metra/db/market-units';
import { comparisonForm } from './compare';
import { atPriceBookScale, withFivePercentMargin } from './margin';
import { ITEM_CODE_PREFIX, itemCode, seedNames, type SeedNames } from './naming';
import { SectionPlanner } from './sections';
import { SKIP_REASONS, type ItemToCreate, type MarketSeedItem, type SeedPlan, type SkipReason, type StudioBook } from './types';

/** Why an item is not created, or null. Names clash only with the studio's OWN items. */
function skipReason(item: MarketSeedItem, book: StudioBook, linked: Set<string>, code: string, names: SeedNames, ownNames: Set<string>): SkipReason | null {
  if (linked.has(item.id)) return 'already_linked';
  if (item.status !== 'active') return 'discontinued';
  if (studioUnitFor(item.unit) === null) return 'unit_unsupported';
  if (item.latestPrice === null) return 'no_price';
  if (book.items.some((existing) => existing.code === code)) return 'code_clash';
  return ownNames.has(comparisonForm(names.nameAr)) || ownNames.has(comparisonForm(names.nameEn)) ? 'name_clash' : null;
}

/**
 * `items` is the WHOLE published set (names are made unique over it). A studio
 * item linked to a market item, or carrying a seed code, is the seed's own: it
 * never counts as a name clash, so a re-run after a partial undo re-seeds.
 */
export function planSeed(items: MarketSeedItem[], book: StudioBook): SeedPlan {
  const names = seedNames(items);
  const linked = new Set(book.items.flatMap((existing) => (existing.marketItemId ? [existing.marketItemId] : [])));
  const own = book.items.filter((existing) => existing.marketItemId === null && !existing.code.startsWith(ITEM_CODE_PREFIX));
  const ownNames = new Set(own.flatMap((existing) => [comparisonForm(existing.nameAr), comparisonForm(existing.nameEn)]).filter((form) => form !== ''));
  const skipped = Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>;
  const sections = new SectionPlanner(book);
  const itemsToCreate: ItemToCreate[] = [];
  for (const item of items) {
    const code = itemCode(item.key);
    const named = names.get(item.id) as SeedNames;
    const reason = skipReason(item, book, linked, code, named, ownNames);
    if (reason !== null) {
      skipped[reason] += 1;
      continue;
    }
    itemsToCreate.push({
      marketItemId: item.id,
      section: sections.target(item),
      code,
      ...named,
      unit: studioUnitFor(item.unit) as CostItemUnit,
      defaultUnitCost: atPriceBookScale(item.latestPrice as string),
      defaultUnitPrice: withFivePercentMargin(item.latestPrice as string),
    });
  }
  return { sectionsPresent: sections.reused.size, sectionsToCreate: [...sections.created.values()], itemsToCreate, skipped };
}
