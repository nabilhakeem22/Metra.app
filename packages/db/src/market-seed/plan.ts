// What seeding one studio's price book from the seed book would do, decided
// purely from the book and what the studio already has. The plan never touches
// a studio row: an item or section the studio already has is left exactly as
// it is, and a clash is skipped, never overwritten.
import type { CostItemUnit } from '../schema/enums';
import { comparisonForm } from './compare';
import { ITEM_CODE_PREFIX } from './naming';
import { SectionPlanner } from './sections';
import { SKIP_REASONS, type ItemRef, type SeedBookEntry, type SeedPlan, type SeedPlanEntry, type SkipReason, type StudioBook } from './types';

interface StudioIndex {
  linked: Set<string>;
  codes: Set<string>;
  ownNames: Set<string>;
}

/**
 * A studio item linked to a market item, or carrying a seed code, is the
 * seed's own: it never counts as a name clash, so a re-run after a partial
 * undo re-seeds. Names clash only with the studio's OWN items.
 */
export function isOwnItem(existing: StudioBook['items'][number]): boolean {
  return existing.marketItemId === null && !existing.code.startsWith(ITEM_CODE_PREFIX);
}

/** Whether any entry's name forms can matter to `studio`'s plan: only its own items are compared with them. */
export function canClashByName(studio: StudioBook): boolean {
  return studio.items.some(isOwnItem);
}

function indexOf(studio: StudioBook): StudioIndex {
  const own = studio.items.filter(isOwnItem);
  const ownNames = new Set(own.flatMap((existing) => [comparisonForm(existing.nameAr), comparisonForm(existing.nameEn)]));
  ownNames.delete('');
  return {
    linked: new Set(studio.items.flatMap((existing) => (existing.marketItemId ? [existing.marketItemId] : []))),
    codes: new Set(studio.items.map((existing) => existing.code)),
    ownNames,
  };
}

/** Why an entry is not created, or null; the first reason that applies, in this order. */
function skipReason(entry: SeedPlanEntry, index: StudioIndex): SkipReason | null {
  if (index.linked.has(entry.marketItemId)) return 'already_linked';
  if (entry.status !== 'active') return 'discontinued';
  if (entry.unit === null) return 'unit_unsupported';
  if (!entry.priced) return 'no_price';
  if (index.codes.has(entry.code)) return 'code_clash';
  return entry.nameForms.some((form) => index.ownNames.has(form)) ? 'name_clash' : null;
}

/** THE decisions, once: which entries are created, in which section, and why each other one is skipped. */
function planWith<Entry extends SeedPlanEntry, Item extends ItemRef>(
  book: Entry[],
  studio: StudioBook,
  itemOf: (entry: Entry, section: ItemRef['section']) => Item,
): SeedPlan<Item> {
  const index = indexOf(studio);
  const skipped = Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>;
  const sections = new SectionPlanner(studio);
  const itemsToCreate: Item[] = [];
  for (const entry of book) {
    const reason = skipReason(entry, index);
    if (reason === null) itemsToCreate.push(itemOf(entry, sections.target(entry)));
    else skipped[reason] += 1;
  }
  return { sectionsPresent: sections.reused.size, sectionsToCreate: [...sections.created.values()], itemsToCreate, skipped };
}

/** The plan with each item in full (the owner's CLI prints and tests it). */
export function planSeed(book: SeedBookEntry[], studio: StudioBook): SeedPlan {
  return planWith(book, studio, (entry, section) => ({
    marketItemId: entry.marketItemId,
    section,
    code: entry.code,
    nameAr: entry.nameAr,
    nameEn: entry.nameEn,
    unit: entry.unit as CostItemUnit,
    defaultUnitCost: entry.unitCost as string,
    defaultUnitPrice: entry.unitPrice as string,
  }));
}

/** The same plan by reference (the app: the write takes names and prices from the stored book). */
export function planSeedRefs(book: SeedPlanEntry[], studio: StudioBook): SeedPlan<ItemRef> {
  return planWith(book, studio, (entry, section) => ({ marketItemId: entry.marketItemId, section, code: entry.code }));
}
