// How far a studio's own unit cost sits from the official guide price of the
// market item it is linked to. Pure and client-safe. Advisory only: nothing
// here ever changes a cost or a price. No unit conversion in v1, so a pair of
// units that do not compare (./units.ts) has no figure at all.
import type { CostItemUnit, MarketUnit } from '@metra/db';
import { percentChange } from '@metra/db/market-percent';
import { unitsCompatible } from './units';

export type MarketVarianceReason = 'ok' | 'unit_mismatch' | 'no_price';

export interface MarketVariance {
  /**
   * "5.0" = the studio's cost is 5% above the official price; "-3.4" below.
   * Null unless `reason` is ok, and also null when the cost is hidden: beside
   * the public price it would give the cost away.
   */
  variancePct: string | null;
  reason: MarketVarianceReason;
}

/** `studio.unitCost` is null for a caller who may not see margin: the price stands, with no figure. */
export function marketVariance(
  studio: { unit: CostItemUnit; unitCost: string | null },
  market: { unit: MarketUnit; price: string | null },
): MarketVariance {
  if (!unitsCompatible(studio.unit, market.unit)) return { variancePct: null, reason: 'unit_mismatch' };
  if (studio.unitCost === null) return { variancePct: null, reason: market.price === null ? 'no_price' : 'ok' };
  return priceVariance(studio.unitCost, market.price);
}

/**
 * The same figure for a pair already known to compare: a read that matched the
 * studio unit against the seed book's (market_seed_book.unit IS the market
 * unit's studio twin, ./units.ts), so no market unit travels with it.
 */
export function priceVariance(studioUnitCost: string, marketPrice: string | null): MarketVariance {
  const variancePct = percentChange(marketPrice, studioUnitCost);
  return variancePct === null ? { variancePct: null, reason: 'no_price' } : { variancePct, reason: 'ok' };
}
