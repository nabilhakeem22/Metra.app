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
