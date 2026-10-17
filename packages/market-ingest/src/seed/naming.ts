// How a market item reads in a studio's price book: a stable code derived from
// its market key, its name with spec (and a roll's pack size), and the section
// key that marks a section the seed created.
import type { RollPack } from '../roll-pack';

/** Sections the seed creates carry `market.<sub-category key>` in sections.key. */
export const SECTION_KEY_PREFIX = 'market.';
/** Cost items the seed creates carry `MKT-<market key>` as their code. */
export const ITEM_CODE_PREFIX = 'MKT-';

export function sectionKey(leafKey: string): string {
  return `${SECTION_KEY_PREFIX}${leafKey}`;
}

/** 'finishing.glass.clear_4mm' -> 'MKT-finishing.glass.clear_4mm' (market keys are unique). */
export function itemCode(marketKey: string): string {
  return `${ITEM_CODE_PREFIX}${marketKey}`;
}

function packWords(pack: RollPack): { ar: string; en: string } {
  return pack.lengthM !== null
    ? { ar: `لفة ${pack.lengthM} م`, en: `roll of ${pack.lengthM} m` }
    : { ar: `لفة ${pack.pieces}×${pack.pieceLengthM} م`, en: `roll of ${pack.pieces} x ${pack.pieceLengthM} m` };
}

/** Name and spec, then a roll's pack: «أسلاك نحاس معزول 2 مم لفة 100 م». */
export function itemNames(item: {
  nameAr: string;
  nameEn: string;
  specAr: string | null;
  specEn: string | null;
  pack: RollPack | null;
}): { nameAr: string; nameEn: string } {
  const pack = item.pack === null ? null : packWords(item.pack);
  return {
    nameAr: [item.nameAr, item.specAr, pack?.ar].filter(Boolean).join(' '),
    nameEn: [item.nameEn, item.specEn, pack?.en].filter(Boolean).join(' '),
  };
}
