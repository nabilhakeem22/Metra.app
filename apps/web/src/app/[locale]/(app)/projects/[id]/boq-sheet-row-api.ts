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
 */
export interface BoqSheetRowApi {
  canEdit: boolean;
  pending: boolean;
  money(value: string): string;
  cellValue(line: EditableLine, column: Column): string;
  setCell(lineId: string, column: Column, value: string): void;
  onCellBlur(line: EditableLine, column: Column): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>, line: EditableLine, column: Column): void;
  amountOf(line: EditableLine): string;
  isDirty(lineId: string): boolean;
  isSaving(lineId: string): boolean;
  saveLine(line: EditableLine, patch: BoqLinePatch, columns: Column[]): void;
  onDeleteLine(lineId: string): void;
  onAddLine(sectionId: string): void;
}
