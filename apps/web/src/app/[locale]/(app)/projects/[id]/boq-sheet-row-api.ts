import type { KeyboardEvent } from 'react';
import type { BoqLinePatch } from '@/lib/boqs/edit-input';
import type { Column, EditableLine } from './boq-sheet-columns';

/**
 * Everything a row, a cell or a section body needs from the sheet's two hooks,
 * as ONE explicit interface.
 *
 * It lives in its own plain module so that every file in the split can name the
 * contract without importing a component from a sibling — which is how a UI
 * folder acquires an import cycle it then hides behind a barrel.
 *
 * EVERY MEMBER IS STABLE FOR THE LIFE OF THE SHEET. That is the contract, not an
 * implementation detail: a row is `React.memo`'d, so anything that changes
 * between renders travels as its OWN prop (what this row has typed, whether it
 * is saving, whether a write is in flight) and never inside this bundle. When
 * this object carried per-render closures and per-row state, memo could not bail
 * out of a single row and one keystroke re-rendered the whole sheet.
 */
export interface BoqSheetRowApi {
  canEdit: boolean;
  money(value: string): string;
  setCell(lineId: string, column: Column, value: string): void;
  onCellBlur(line: EditableLine, column: Column): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>, line: EditableLine, column: Column): void;
  saveLine(line: EditableLine, patch: BoqLinePatch, columns: Column[]): void;
  onDeleteLine(lineId: string): void;
  onAddLine(sectionId: string): void;
}
