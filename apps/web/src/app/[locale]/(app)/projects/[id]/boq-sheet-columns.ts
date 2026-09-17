import { computeLine } from '@/lib/aggregates/proposal-totals';
import type { BoqLineRow } from '@/lib/boqs/queries';

// The BOQ sheet's COLUMN vocabulary. A plain module, not 'use client': it holds
// only types and pure functions, so a server component may read it without
// dragging a client-reference proxy across the boundary.

/** Every column a studio can type into. The amount column is computed, not typed. */
export type Column = 'itemCode' | 'description' | 'unit' | 'qty' | 'unitPrice';

/** A line that remembers which section it came from, so a save knows its row. */
export interface EditableLine extends BoqLineRow {
  sectionId: string;
}

/** What ONE row holds locally: the columns typed into but not yet committed. */
export type RowEdits = Partial<Record<Column, string>>;

/** lineId -> what that row holds locally. */
export type CellEdits = Record<string, RowEdits>;

/** Trim a stored scale-4 figure to something worth typing over: 8.5000 -> 8.5 */
export function trimNumber(value: string): string {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

/**
 * What the STORED record says this column is, as the studio would type it.
 *
 * There used to be TWO copies of this switch in one file: the branches inside
 * `cellValue`, which produced what was on screen, and a second copy three hundred
 * lines below it, which `onCellBlur` compared the typed value against. Two
 * five-branch switches that must agree, that far apart, is a drift waiting to
 * happen — and the drift would have shown up as a save that fired on a cell
 * nobody changed. One switch, one home.
 */
export function recordValue(line: EditableLine, column: Column): string {
  switch (column) {
    case 'itemCode':
      return line.itemCode ?? '';
    case 'description':
      return line.description;
    case 'qty':
      return trimNumber(line.qty);
    case 'unitPrice':
      return trimNumber(line.unitPrice);
    case 'unit':
      return line.unit;
  }
}

/**
 * What a cell should SHOW: the local edit if there is one, else the record.
 *
 * It takes the row's own edits rather than the whole sheet's, because that is
 * what a row is handed as a prop — which is what lets the row be memoised and a
 * keystroke re-render one row instead of two thousand.
 */
export function cellValueOf(
  line: EditableLine,
  column: Column,
  typed: RowEdits | undefined,
): string {
  return typed?.[column] ?? recordValue(line, column);
}

/**
 * The amount as it will be STORED, recomputed from what is on screen.
 *
 * It runs the SAME `computeLine` the server runs, so the number the studio is
 * steering by while typing is the number that lands in the row — rather than a
 * browser-side approximation that disagrees with the document by a piastre.
 */
export function amountOf(line: EditableLine, typed: RowEdits | undefined): string {
  const qty = typed?.qty;
  const unitPrice = typed?.unitPrice;
  if (qty === undefined && unitPrice === undefined) return line.lineTotal;
  return computeLine({
    qty: qty ?? line.qty,
    unitPrice: unitPrice ?? line.unitPrice,
    unitCost: '0',
    discountPct: line.discountPct,
  }).lineTotal;
}
