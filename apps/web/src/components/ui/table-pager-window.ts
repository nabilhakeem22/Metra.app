// Which page numbers a TablePager shows. PURE and client-safe: no imports.

/** One place in the pager's row of numbers: a page link, or a gap of hidden pages. */
export type PagerSlot = { kind: 'page'; page: number } | { kind: 'gap'; after: number };

/** How many pages `total` rows fill at `pageSize` a page; never fewer than one. */
export function pageCountOf(total: number, pageSize: number): number {
  if (!(total > 0) || !(pageSize > 0)) return 1;
  return Math.ceil(total / pageSize);
}

/**
 * The first page, the last, and the current one with its neighbours, in order,
 * with a gap wherever pages are skipped: 1 … 4 5 6 … 12. A gap that would hide
 * a single page shows that page instead (1 2 3 4, not 1 … 3 4): the same width,
 * one less click. `page` outside [1, pageCount] is read as the nearest end.
 */
export function pagerSlots(page: number, pageCount: number): PagerSlot[] {
  const last = Math.max(1, Math.floor(pageCount));
  const current = Math.min(Math.max(1, Math.floor(page)), last);
  const shown = [...new Set([1, current - 1, current, current + 1, last])]
    .filter((candidate) => candidate >= 1 && candidate <= last)
    .sort((a, b) => a - b);

  const slots: PagerSlot[] = [];
  let previous = 0;
  for (const shownPage of shown) {
    if (shownPage - previous === 2) slots.push({ kind: 'page', page: previous + 1 });
    else if (shownPage - previous > 2) slots.push({ kind: 'gap', after: previous });
    slots.push({ kind: 'page', page: shownPage });
    previous = shownPage;
  }
  return slots;
}
