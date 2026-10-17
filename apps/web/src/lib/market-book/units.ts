// Market units against studio units: which studio unit "Add to my price book"
// creates, and when a studio cost may be compared with a market price. Pure and
// client-safe: @metra/db types, and the leaf module @metra/db/market-units.
//
// The market-to-studio unit table lives in @metra/db/market-units (one table
// for this module and the owner's seed command); see its header for the
// no-closest-unit decision.
//
// A ROLL compares only with the market item it is LINKED to: the studio's `roll`
// means one roll of that item's pack size (a 100 m roll and a 45 m roll are
// different market items), so unit `roll` on both sides of a link is compatible.
import type { CostItemUnit, MarketUnit } from '@metra/db';
import { STUDIO_UNIT_FOR_MARKET_UNIT } from '@metra/db/market-units';

export { studioUnitFor } from '@metra/db/market-units';

/** Whether a studio cost in `costUnit` may be compared with a market price in `marketUnit`. */
export function unitsCompatible(costUnit: CostItemUnit, marketUnit: MarketUnit): boolean {
  return STUDIO_UNIT_FOR_MARKET_UNIT[marketUnit] === costUnit;
}
