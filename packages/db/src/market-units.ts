// The studio unit a market unit becomes in a price book, or null when no studio
// unit fits. A LEAF (type imports only), so the client-safe web module
// (apps/web/src/lib/market-book/units.ts) and the owner's seed command
// (packages/market-ingest) read one table.
//
// DECISION (Oct 17 2026): no "closest unit". «عبوة» (pack), «ألف طوبة» (1000
// bricks) and «شيكارة» (bag) have no studio unit and are refused: a per-pack
// price labelled per piece would make every later comparison quietly wrong. A
// market `roll` becomes a studio `roll` that means one roll of THAT item's pack.
import type { CostItemUnit, MarketUnit } from './schema/enums';

export const STUDIO_UNIT_FOR_MARKET_UNIT: Record<MarketUnit, CostItemUnit | null> = {
  ton: 'ton',
  kg: 'kg',
  sqm: 'sqm',
  cbm: 'cbm',
  linear_meter: 'linear_meter',
  liter: 'liter',
  pcs: 'pcs',
  roll: 'roll',
  bag: null,
  pack: null,
  thousand_bricks: null,
};

/** The studio unit a market item is added to a price book in, or null when it cannot be. */
export function studioUnitFor(marketUnit: MarketUnit): CostItemUnit | null {
  return STUDIO_UNIT_FOR_MARKET_UNIT[marketUnit];
}
