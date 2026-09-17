import type { PriceBookItem, SectionOption } from './types';

// WHICH COST ITEMS THE PRICE BOOK SHOWS, and how they are grouped. PURE and
// server-safe: no React, no db. Two `useMemo`s in a render body are the same
// defect class as the clients list (R3) — a product rule nobody can call.

export interface PriceBookFilter {
  query: string;
  /** A section id, or 'all'. */
  sectionId: string;
  /** Hide retired items. Off by default: the book is a catalogue, not a list of
   *  what is currently on offer. */
  activeOnly: boolean;
}

/** One section and the items under it. */
export interface PriceBookGroup {
  section: SectionOption;
  rows: PriceBookItem[];
}

/** Search by CODE and by name, in either language. */
function matchesQuery(item: PriceBookItem, needle: string): boolean {
  if (needle === '') return true;
  const haystack = `${item.code} ${item.nameEn ?? ''} ${item.nameAr ?? ''}`.toLowerCase();
  return haystack.includes(needle);
}

export function filterCostItems(
  items: readonly PriceBookItem[],
  filter: PriceBookFilter,
): PriceBookItem[] {
  const needle = filter.query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (filter.sectionId === 'all' || item.sectionId === filter.sectionId) &&
      (!filter.activeOnly || item.active) &&
      matchesQuery(item, needle),
  );
}

/**
 * Group the visible items by section, in the SECTIONS' own order, and drop the
 * empty groups.
 *
 * Dropping them is the point: a filtered book that still lists twelve empty
 * section headings reads as "nothing matched" twelve times over. An item whose
 * section is not in `sections` is not rendered at all — it has no heading to sit
 * under, and inventing one would be inventing a section.
 */
export function groupBySection(
  items: readonly PriceBookItem[],
  sections: readonly SectionOption[],
): PriceBookGroup[] {
  return sections
    .map((section) => ({
      section,
      rows: items.filter((item) => item.sectionId === section.id),
    }))
    .filter((group) => group.rows.length > 0);
}
