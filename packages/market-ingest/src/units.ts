// The unit map (C6.5): a printed Arabic unit label to a market unit, and for a
// roll its pack size (roll-pack.ts). An unknown label is B3; extending this map
// is a PR, never a session decision.
import type { MarketUnit } from '@metra/db/schema';
import { normalizeArabic } from './normalize';
import { parseRollPack, type RollPack } from './roll-pack';

export type { MarketUnit };

export interface UnitReading {
  unit: MarketUnit;
  /** Set for a roll (and only a roll): its pack size is part of the item's identity. */
  pack: RollPack | null;
}

/** Labels as a reader writes them; matching uses their normalised, space-free form. */
export const PRINTED_UNITS: ReadonlyArray<[label: string, unit: MarketUnit]> = [
  ['طن', 'ton'],
  ['الطن', 'ton'],
  ['كجم', 'kg'],
  ['كيلوجرام', 'kg'],
  ['م2', 'sqm'],
  ['متر مربع', 'sqm'],
  ['متر مسطح', 'sqm'],
  ['م3', 'cbm'],
  ['متر مكعب', 'cbm'],
  ['متر طولي', 'linear_meter'],
  ['م.ط', 'linear_meter'],
  ['م.طولي', 'linear_meter'],
  ['م طولي', 'linear_meter'],
  ['لتر', 'liter'],
  ['اللتر', 'liter'],
  ['عدد', 'pcs'],
  ['اللوح', 'pcs'],
  ['لوح', 'pcs'],
  ['عود', 'pcs'],
  ['شيكارة', 'bag'],
  ['عبوة', 'pack'],
  ['ألف طوبة', 'thousand_bricks'],
];

/** The matching form of a unit label: normalised Arabic with every space removed. */
export function unitMatchingForm(label: string): string {
  return normalizeArabic(label).replace(/\s+/g, '');
}

const UNIT_BY_FORM = new Map(PRINTED_UNITS.map(([label, unit]) => [unitMatchingForm(label), unit]));

/** The market unit (and roll pack) of a printed label, or null when the map does not know it (B3). */
export function marketUnitOf(unitLabelAr: string): UnitReading | null {
  const pack = parseRollPack(unitLabelAr);
  if (pack !== null) return { unit: 'roll', pack };
  const unit = UNIT_BY_FORM.get(unitMatchingForm(unitLabelAr));
  return unit === undefined ? null : { unit, pack: null };
}
