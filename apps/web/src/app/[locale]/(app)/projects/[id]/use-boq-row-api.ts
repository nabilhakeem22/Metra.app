'use client';

import { useLocale } from 'next-intl';
import { useCallback, useMemo, type KeyboardEvent, type RefObject } from 'react';
import { formatMoney } from '@/lib/format/money';
import type { Column, EditableLine } from './boq-sheet-columns';
import { focusNextInColumn } from './boq-sheet-focus';
import type { BoqSheetRowApi } from './boq-sheet-row-api';
import type { BoqEditsApi } from './use-boq-edits';
import type { BoqWritesApi } from './use-boq-writes';

export interface BoqRowApiOptions {
  canEdit: boolean;
  edits: BoqEditsApi;
  writes: BoqWritesApi;
  /** The table, for Enter-walks-down-the-column. */
  gridRef: RefObject<HTMLTableElement | null>;
}

/**
 * Enter walks DOWN the column, which is how a rate list is actually typed. Tab
 * still moves across. Escape puts the cell back and writes nothing.
 */
function columnKeyHandler(
  clearColumns: BoqEditsApi['clearColumns'],
  gridRef: RefObject<HTMLTableElement | null>,
) {
  return (event: KeyboardEvent<HTMLElement>, line: EditableLine, column: Column): void => {
    if (event.key === 'Escape') {
      clearColumns(line.id, [column]);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    focusNextInColumn(gridRef.current, column, event.currentTarget);
  };
}

/**
 * The ONE bundle every row, cell and section body is handed — and the reason it
 * is stable.
 *
 * Every member has to keep its identity for the life of the sheet, because the
 * rows are `React.memo`'d: one new closure in here would hand all 2,000 rows a
 * changed prop on every keystroke and the memo would bail out of nothing. So
 * `money` is memoised on the locale, the key handler on the one edits callback
 * it uses (itself stable), and the bundle on those. Anything that changes per
 * render or per row — `pending`, this row's edits, whether this row is saving —
 * travels as its own prop instead.
 */
export function useBoqRowApi(options: BoqRowApiOptions): BoqSheetRowApi {
  const locale = useLocale();
  const { canEdit, edits, writes, gridRef } = options;
  const { setCell, clearColumns } = edits;
  const { onCellBlur, saveLine, onDeleteLine, onAddLine } = writes;

  const money = useCallback((value: string) => formatMoney(value, locale), [locale]);
  const onKeyDown = useMemo(
    () => columnKeyHandler(clearColumns, gridRef),
    [clearColumns, gridRef],
  );

  return useMemo(
    () => ({
      canEdit,
      money,
      onKeyDown,
      setCell,
      onCellBlur,
      saveLine,
      onDeleteLine,
      onAddLine,
    }),
    [canEdit, money, onKeyDown, setCell, onCellBlur, saveLine, onDeleteLine, onAddLine],
  );
}
