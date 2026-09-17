import type { Column } from './boq-sheet-columns';

// Keyboard movement inside the BOQ sheet. A plain module, not 'use client': it
// takes the elements it works on as arguments and holds no React state.

/**
 * Enter walks DOWN the column, which is how a rate list is actually typed. Tab
 * still moves across.
 *
 * The cells of one column are found by their `data-col` attribute rather than by
 * index arithmetic, because sections collapse and a search filters rows — the
 * visual order is the only order that means anything to the person typing.
 *
 * Returns the element that took focus, or null at the bottom of the column.
 * The last cell in a column focuses nothing and throws nothing: a studio pressing
 * Enter on the final rate has finished, and an exception there would be absurd.
 */
export function focusNextInColumn(
  table: HTMLTableElement | null,
  column: Column,
  current: HTMLElement,
): HTMLElement | null {
  const cells = table?.querySelectorAll<HTMLElement>(`[data-col="${column}"]`);
  if (!cells) return null;
  const inColumn = [...cells];
  const next = inColumn[inColumn.indexOf(current) + 1];
  if (!next) return null;
  next.focus();
  return next;
}
