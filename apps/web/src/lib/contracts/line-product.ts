// Whether a client contract line reads as "quantity × unit price = total".
// PURE and CLIENT-SAFE.
import { computeLine, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { PublicContractLine } from './public-types';

/**
 * True when the line's total is its quantity times its unit price, at the
 * money engine's own rounding; false for a line with a discount of its own,
 * whose total the product would contradict.
 */
export function totalIsQuantityTimesPrice(line: Pick<PublicContractLine, 'qty' | 'unit_price' | 'line_total'>): boolean {
  const product = computeLine({ qty: line.qty, unitCost: '0', unitPrice: line.unit_price, discountPct: '0' }).lineTotal;
  return parseMoney4(product) === parseMoney4(line.line_total);
}
