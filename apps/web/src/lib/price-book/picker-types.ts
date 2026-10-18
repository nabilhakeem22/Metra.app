// What the builder's "From price book" picker is answered with
// (picker-query.ts, through picker-actions.ts). Types and one limit only, so
// the client picker shares them without reaching for a server module.

/** The most rows one picker answer carries; the rest are counted, and narrowed by typing. */
export const PICKER_LIMIT = 30;

/** An item the picker offers: what a new line copies from the price book. */
export interface PickerItem {
  id: string;
  code: string;
  /** Its section, or null when that section is retired (listed last, under "other items"). */
  sectionId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  unit: string;
  /** Null for a role that may not see cost (canSeeMargin): the save takes the cost from the price book. */
  defaultUnitCost: string | null;
  defaultUnitPrice: string;
}

export interface PickerSearch {
  items: PickerItem[];
  /** How many active items match, shown or not. */
  matched: number;
}
