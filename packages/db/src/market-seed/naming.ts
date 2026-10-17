// How a market item reads in a studio's price book: a stable code derived from
// its market key, its name with spec (and a roll's pack size), and the section
// key that marks a section the seed created. Names are decided over the WHOLE
// seed set at once, so they are the same on every run and in every studio, and
// no two seeded items read alike.
import type { RollPack } from './types';
import { comparisonForm } from './compare';

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

export interface NamedItem {
  id: string;
  nameAr: string;
  nameEn: string;
  specAr: string | null;
  specEn: string | null;
  pack: RollPack | null;
  leafNameAr: string;
  leafNameEn: string;
}

export interface SeedNames {
  nameAr: string;
  nameEn: string;
}

function packWords(pack: RollPack): { ar: string; en: string } {
  return pack.lengthM !== null
    ? { ar: `لفة ${pack.lengthM} م`, en: `roll of ${pack.lengthM} m` }
    : { ar: `لفة ${pack.pieces}×${pack.pieceLengthM} م`, en: `roll of ${pack.pieces} x ${pack.pieceLengthM} m` };
}

const commaParts = (text: string) => text.split(/\s*[,،]\s*/).filter((part) => part !== '');

/** The spec without the comma-separated parts the name already has ("light gauge" twice). */
function specBeyondName(name: string, spec: string | null): string | null {
  if (spec === null) return null;
  const said = new Set(commaParts(name).map(comparisonForm));
  const parts = commaParts(spec).filter((part) => !said.has(comparisonForm(part)));
  return parts.length === 0 ? null : parts.join(', ');
}

/**
 * The seeded names: the printed names with Arabic " - " separators copied from
 * the bulletin as «، » (the no-dash rule); a hyphen inside a spec (a range such
 * as «4مم-6مم» or «600-700») stays.
 */
function baseNames(item: NamedItem): SeedNames {
  const printed = printedWithPack(item);
  return { nameAr: printed.nameAr.replace(/\s+-\s+/g, '، '), nameEn: printed.nameEn };
}

/** Name, spec (without what the name already says), then a roll's pack unless the text already says roll: no rewrite. */
function printedWithPack(item: NamedItem): SeedNames {
  const pack = item.pack === null ? null : packWords(item.pack);
  const ar = [item.nameAr, item.specAr].filter(Boolean).join(' ');
  const en = [item.nameEn, specBeyondName(item.nameEn, item.specEn)].filter(Boolean).join(' ');
  const arPack = pack !== null && !comparisonForm(ar).includes('لفه') ? pack.ar : null;
  const enPack = pack !== null && !/\broll\b/i.test(en) ? pack.en : null;
  return { nameAr: [ar, arPack].filter(Boolean).join(' '), nameEn: [en, enPack].filter(Boolean).join(' ') };
}

/**
 * The ways a studio may already have typed this item, as the bulletin prints
 * it: name and spec, with and without the pack, BEFORE the " - " rewrite and
 * the sub-category suffix. A studio item read as any of them is a name clash.
 */
export function printedNames(item: NamedItem): string[] {
  const withPack = printedWithPack(item);
  const bare = [[item.nameAr, item.specAr], [item.nameEn, item.specEn]].map((parts) => parts.filter(Boolean).join(' '));
  return [withPack.nameAr, withPack.nameEn, ...bare];
}

/** Make each language's names unique: a name two items share gets each item's sub-category. */
function disambiguate(items: NamedItem[], names: Map<string, SeedNames>, field: keyof SeedNames, leaf: 'leafNameAr' | 'leafNameEn'): void {
  const groups = new Map<string, NamedItem[]>();
  for (const item of items) {
    const form = comparisonForm((names.get(item.id) as SeedNames)[field]);
    groups.set(form, [...(groups.get(form) ?? []), item]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      const named = names.get(item.id) as SeedNames;
      names.set(item.id, { ...named, [field]: `${named[field]} (${item[leaf]})` });
    }
  }
}

export function seedNames(items: NamedItem[]): Map<string, SeedNames> {
  const names = new Map(items.map((item) => [item.id, baseNames(item)]));
  disambiguate(items, names, 'nameAr', 'leafNameAr');
  disambiguate(items, names, 'nameEn', 'leafNameEn');
  return names;
}
