import type { ReactNode } from 'react';

// A table that is a table from sm up and, below it, stacks each row as a card
// (B5 F3, A5 fix round F1): the first cell across the full width, then every
// figure under its own small label, then the row's action, so nothing a row
// says or offers is pushed off a 390 px phone screen into a sideways scroll.
// The head is hidden below sm; each cell carries its label instead.

export const STACKED_TABLE = 'block w-full text-body sm:table';
export const STACKED_HEAD = 'hidden text-caption text-muted-foreground sm:table-header-group';
export const STACKED_BODY = 'block sm:table-row-group';
export const STACKED_ROW = 'flex flex-wrap items-start gap-x-5 gap-y-2 border-b py-3 last:border-0 sm:table-row sm:py-0';
/** A cell; add `sm:text-end` for a figure. */
export const STACKED_CELL = 'block sm:table-cell sm:py-2 sm:pe-3 sm:align-top';
/** The row's first cell: the whole width of the stacked card. */
export const STACKED_LEAD_CELL = `${STACKED_CELL} basis-full`;
/** The row's action: at the card's end below sm, the last column from sm up. */
export const STACKED_ACTION_CELL = 'block ms-auto self-center sm:ms-0 sm:table-cell sm:py-2 sm:text-end sm:align-top';

/** The column's name over a cell's value, shown only while the row is stacked. */
export function StackedLabel({ children }: { children: ReactNode }) {
  return <span className="block text-caption text-muted-foreground sm:hidden">{children}</span>;
}
