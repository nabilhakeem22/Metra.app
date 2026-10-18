import type { PriceBookItem, SectionOption } from './types';

// HOW ONE PAGE OF THE PRICE BOOK IS GROUPED. PURE and server-safe: no React,
// no db. The database already filtered, searched and ordered the page
// (lib/price-book/page-query.ts); this only puts each run of rows under its
// section's heading, in the order the rows came.

/** One section and its rows on this page. */
export interface PriceBookGroup {
  section: SectionOption;
  rows: PriceBookItem[];
  /** How many items of this section match, on every page (a section can run across two). */
  matched: number;
}

/**
 * The page's rows grouped by section, keeping their order. A row whose section
 * is not in `sections` is not rendered: it has no heading to sit under, and
 * inventing one would be inventing a section.
 */
export function groupPageRows(
  rows: readonly PriceBookItem[],
  sections: readonly SectionOption[],
  sectionCounts: Readonly<Record<string, number>>,
): PriceBookGroup[] {
  const known = new Map(sections.map((section) => [section.id, section]));
  const groups: PriceBookGroup[] = [];
  for (const row of rows) {
    const section = known.get(row.sectionId);
    if (!section) continue;
    const last = groups.at(-1);
    if (last?.section.id === section.id) last.rows.push(row);
    else groups.push({ section, rows: [row], matched: sectionCounts[section.id] ?? 0 });
  }
  return groups;
}
