// What seeding one studio's price book from the published market book would
// do, decided purely from the market items and what the studio already has.
// The plan never touches a studio row: an item or section the studio already
// has is left exactly as it is, and a clash is skipped, never overwritten.
import type { CostItemUnit, MarketUnit } from '@metra/db/schema';
import { studioUnitFor } from '@metra/db/market-units';
import { normalizeArabic } from '../normalize';
import type { RollPack } from '../roll-pack';
import { atPriceBookScale, withFivePercentMargin } from './margin';
import { SECTION_KEY_PREFIX, itemCode, itemNames, sectionKey } from './naming';

export interface MarketSeedItem {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  specAr: string | null;
  specEn: string | null;
  unit: MarketUnit;
  pack: RollPack | null;
  status: 'active' | 'discontinued';
  leafKey: string;
  leafNameAr: string;
  leafNameEn: string;
  topNameAr: string;
  topNameEn: string;
  /** The newest published month with a numeric price, or null when there is none. */
  latestPrice: string | null;
}

export interface StudioBook {
  sections: Array<{ id: string; key: string | null; nameAr: string | null; nameEn: string | null }>;
  items: Array<{ code: string; nameAr: string | null; nameEn: string | null; marketItemId: string | null }>;
}

export const SKIP_REASONS = ['already_linked', 'discontinued', 'unit_unsupported', 'no_price', 'code_clash', 'name_clash'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface SectionToCreate {
  key: string;
  nameAr: string;
  nameEn: string;
  /** True when the plain sub-category name was already a studio section's name. */
  qualified: boolean;
}

export interface ItemToCreate {
  marketItemId: string;
  sectionKey: string;
  code: string;
  nameAr: string;
  nameEn: string;
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
}

export interface SeedPlan {
  sectionsPresent: number;
  sectionsToCreate: SectionToCreate[];
  itemsToCreate: ItemToCreate[];
  skipped: Record<SkipReason, number>;
}

const englishForm = (name: string | null) => (name ?? '').trim().toLowerCase();
const arabicForm = (name: string | null) => normalizeArabic(name ?? '');

function skipReason(item: MarketSeedItem, book: StudioBook, linked: Set<string>, code: string, names: { nameAr: string; nameEn: string }): SkipReason | null {
  if (linked.has(item.id)) return 'already_linked';
  if (item.status !== 'active') return 'discontinued';
  if (studioUnitFor(item.unit) === null) return 'unit_unsupported';
  if (item.latestPrice === null) return 'no_price';
  if (book.items.some((existing) => existing.code === code)) return 'code_clash';
  const clash = book.items.some(
    (existing) =>
      (existing.nameAr !== null && arabicForm(existing.nameAr) === arabicForm(names.nameAr)) ||
      (existing.nameEn !== null && englishForm(existing.nameEn) === englishForm(names.nameEn)),
  );
  return clash ? 'name_clash' : null;
}

function sectionFor(item: MarketSeedItem, book: StudioBook): SectionToCreate {
  const studioNames = book.sections.flatMap((section) => [arabicForm(section.nameAr), englishForm(section.nameEn)]);
  const clash = studioNames.includes(arabicForm(item.leafNameAr)) || studioNames.includes(englishForm(item.leafNameEn));
  return clash
    ? { key: sectionKey(item.leafKey), nameAr: `${item.leafNameAr} (${item.topNameAr})`, nameEn: `${item.leafNameEn} (${item.topNameEn})`, qualified: true }
    : { key: sectionKey(item.leafKey), nameAr: item.leafNameAr, nameEn: item.leafNameEn, qualified: false };
}

export function planSeed(items: MarketSeedItem[], book: StudioBook): SeedPlan {
  const linked = new Set(book.items.flatMap((existing) => (existing.marketItemId ? [existing.marketItemId] : [])));
  const presentKeys = new Set(book.sections.flatMap((section) => (section.key ? [section.key] : [])));
  const skipped = Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>;
  const itemsToCreate: ItemToCreate[] = [];
  const sections = new Map<string, SectionToCreate>();
  for (const item of items) {
    const code = itemCode(item.key);
    const names = itemNames(item);
    const reason = skipReason(item, book, linked, code, names);
    if (reason !== null) {
      skipped[reason] += 1;
      continue;
    }
    const key = sectionKey(item.leafKey);
    if (!presentKeys.has(key) && !sections.has(key)) sections.set(key, sectionFor(item, book));
    itemsToCreate.push({
      marketItemId: item.id,
      sectionKey: key,
      code,
      ...names,
      unit: studioUnitFor(item.unit) as CostItemUnit,
      defaultUnitCost: atPriceBookScale(item.latestPrice as string),
      defaultUnitPrice: withFivePercentMargin(item.latestPrice as string),
    });
  }
  return {
    sectionsPresent: [...presentKeys].filter((key) => key.startsWith(SECTION_KEY_PREFIX)).length,
    sectionsToCreate: [...sections.values()],
    itemsToCreate,
    skipped,
  };
}
