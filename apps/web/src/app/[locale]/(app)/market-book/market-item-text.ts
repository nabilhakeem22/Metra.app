// How a market item reads in the page's language. Pure. The bulletin prints
// Arabic, so an Arabic page shows its own unit wording («اللفة (100 م.ط)»);
// an English one shows the unit's English label.
import type { MarketItemRow } from '@/lib/market-book/types';

type Named = Pick<MarketItemRow, 'nameAr' | 'nameEn' | 'specAr' | 'specEn' | 'unit' | 'unitLabelAr'>;

const arabic = (locale: string) => locale.startsWith('ar');

export function itemName(item: Named, locale: string): string {
  return arabic(locale) ? item.nameAr : item.nameEn;
}

/** The size or grade; an English page falls back to the Arabic spec when no English one was written. */
export function itemSpec(item: Named, locale: string): string | null {
  return arabic(locale) ? item.specAr : (item.specEn ?? item.specAr);
}

export function itemUnit(item: Named, locale: string, unitLabel: (unit: Named['unit']) => string): string {
  return arabic(locale) ? item.unitLabelAr : unitLabel(item.unit);
}
