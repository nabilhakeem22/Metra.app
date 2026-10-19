// How far a studio's own unit cost sits from the official guide price of the
// market item it is linked to. Pure and client-safe. Advisory only: nothing
// here ever changes a cost or a price. No unit conversion in v1, so a pair of
// units that do not compare (./units.ts) has no figure at all.
import type { CostItemUnit, MarketUnit } from '@metra/db';
import { percentChange } from '@metra/db/market-percent';
import { unitsCompatible } from './units';

export type MarketVarianceReason = 'ok' | 'unit_mismatch' | 'no_price';

export interface MarketVariance {
  /** "5.0" = the studio's cost is 5% above the official price; "-3.4" below. Null unless `reason` is ok. */
  variancePct: string | null;
  reason: MarketVarianceReason;
}

export function marketVariance(
  studio: { unit: CostItemUnit; unitCost: string },
  market: { unit: MarketUnit; price: string | null },
): MarketVariance {
  if (!unitsCompatible(studio.unit, market.unit)) return { variancePct: null, reason: 'unit_mismatch' };
  const variancePct = percentChange(market.price, studio.unitCost);
  return variancePct === null ? { variancePct: null, reason: 'no_price' } : { variancePct, reason: 'ok' };
}
