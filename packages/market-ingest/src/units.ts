// The unit map (C6.5): a printed Arabic unit label to a market unit. An unknown
// label is B3; extending this map is a PR, never a session decision.
import { normalizeArabic } from './normalize';

export const MARKET_UNITS = ['ton', 'kg', 'sqm', 'cbm', 'linear_meter', 'liter', 'pcs', 'roll_100m', 'bag'] as const;
export type MarketUnit = (typeof MARKET_UNITS)[number];

/** Labels as a reader writes them; matching uses their normalised, space-free form. */
const PRINTED_UNITS: Array<[label: string, unit: MarketUnit]> = [
  ['طن', 'ton'],
  ['الطن', 'ton'],
  ['كجم', 'kg'],
  ['كيلوجرام', 'kg'],
  ['م2', 'sqm'],
  ['متر مربع', 'sqm'],
  ['م3', 'cbm'],
  ['متر مكعب', 'cbm'],
  ['متر طولي', 'linear_meter'],
  ['م.ط', 'linear_meter'],
  ['لتر', 'liter'],
  ['اللتر', 'liter'],
  ['عدد', 'pcs'],
  ['اللوح', 'pcs'],
  ['لوح', 'pcs'],
  ['عود', 'pcs'],
  ['شيكارة', 'bag'],
  ['اللفة (100 م.ط)', 'roll_100m'],
];

/** The matching form of a unit label: normalised Arabic with every space removed. */
export function unitMatchingForm(label: string): string {
  return normalizeArabic(label).replace(/\s+/g, '');
}

const UNIT_BY_FORM = new Map(PRINTED_UNITS.map(([label, unit]) => [unitMatchingForm(label), unit]));

/** The market unit of a printed label, or null when the map does not know it (B3). */
export function marketUnitOf(unitLabelAr: string): MarketUnit | null {
  return UNIT_BY_FORM.get(unitMatchingForm(unitLabelAr)) ?? null;
}
