// The seed book: every published market item as a studio's price book would
// receive it (code, names, studio unit, cost and selling price) and the forms a
// studio's own item would clash with. Decided over the WHOLE published set at
// once (names are made unique over it) and independent of any studio, so it
// is built once per published book: by the owner's CLI before it plans
// (packages/market-ingest) and stored for the app (market_seed_book), whose
// per-studio plan is then set lookups only.
import { studioUnitFor } from '../market-units';
import { comparisonForm } from './compare';
import { atPriceBookScale, withFivePercentMargin } from './margin';
import { itemCode, printedNames, seedNames, type SeedNames } from './naming';
import type { MarketSeedItem, SeedBookEntry } from './types';

/** The forms a studio name is compared in: the seeded names and every printed spelling, without blanks. */
function nameFormsOf(item: MarketSeedItem, named: SeedNames): string[] {
  const forms = new Set([named.nameAr, named.nameEn, ...printedNames(item)].map(comparisonForm));
  forms.delete('');
  return [...forms];
}

/** `items` is the WHOLE published set, in the taxonomy's display order; the book keeps that order. */
export function buildSeedBook(items: MarketSeedItem[]): SeedBookEntry[] {
  const names = seedNames(items);
  return items.map((item) => {
    const named = names.get(item.id) as SeedNames;
    return {
      marketItemId: item.id,
      code: itemCode(item.key),
      nameAr: named.nameAr,
      nameEn: named.nameEn,
      nameForms: nameFormsOf(item, named),
      status: item.status,
      unit: studioUnitFor(item.unit),
      priced: item.latestPrice !== null,
      unitCost: item.latestPrice === null ? null : atPriceBookScale(item.latestPrice),
      unitPrice: item.latestPrice === null ? null : withFivePercentMargin(item.latestPrice),
      leafKey: item.leafKey,
      leafNameAr: item.leafNameAr,
      leafNameEn: item.leafNameEn,
      topNameAr: item.topNameAr,
      topNameEn: item.topNameEn,
    };
  });
}
