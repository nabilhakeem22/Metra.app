// Market units against studio units: which studio unit "Add to my price book"
// creates, and when a studio cost may be compared with a market price. Pure and
// client-safe (types only from @metra/db).
//
// DECISION (Wave 0 input, Oct 17 2026): a market unit with no studio unit is NOT
// mapped to a "closest" one. «عبوة» (pack), «ألف طوبة» (1000 bricks) and
// «شيكارة» (bag) are refused: "Add" is disabled with marketBook.unitNotSupported.
// A closest-unit guess would label a per-pack price as per-piece and make every
// later comparison of that item quietly wrong.
//
// A ROLL compares only with the market item it is LINKED to: the studio's `roll`
// means one roll of that item's pack size (a 100 m roll and a 45 m roll are
// different market items), so unit `roll` on both sides of a link is compatible.
import type { CostItemUnit, MarketUnit } from '@metra/db';

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

/** The studio unit "Add to my price book" uses, or null when adding is refused. */
export function studioUnitFor(marketUnit: MarketUnit): CostItemUnit | null {
  return STUDIO_UNIT_FOR_MARKET_UNIT[marketUnit];
}

/** Whether a studio cost in `costUnit` may be compared with a market price in `marketUnit`. */
export function unitsCompatible(costUnit: CostItemUnit, marketUnit: MarketUnit): boolean {
  return STUDIO_UNIT_FOR_MARKET_UNIT[marketUnit] === costUnit;
}
