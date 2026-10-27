// Whether a client contract line reads as "quantity × unit price = total" in
// the figures the page SHOWS. PURE and CLIENT-SAFE.
import { parseMoney4, roundHalfAwayFromZero } from '@/lib/aggregates/proposal-totals';
import type { PublicContractLine } from './public-types';

/** Scale-4 units to whole hundredths: money shows 2 decimals, rounded half away from zero as the page's formatter does. */
function toCents(units4: bigint): bigint {
  return roundHalfAwayFromZero(units4, 100n);
}

/**
 * True when the DISPLAYED quantity (up to 4 decimals, so exact) times the
 * DISPLAYED unit price (2 decimals), rounded to 2 decimals, equals the
 * DISPLAYED line total (2 decimals): the one reading a client can check with a
 * calculator. False for a line with a discount of its own, and for a unit
 * price whose 2-decimal face makes the product miss the total (3 × 10.0050 =
 * 30.0150 shows 3 × 10.01 = 30.02, not 30.03).
 */
export function totalIsQuantityTimesPrice(line: Pick<PublicContractLine, 'qty' | 'unit_price' | 'line_total'>): boolean {
  // qty is scale 4, the shown price scale 2: the product is in millionths.
  const product = parseMoney4(line.qty) * toCents(parseMoney4(line.unit_price));
  return roundHalfAwayFromZero(product, 10000n) === toCents(parseMoney4(line.line_total));
}
