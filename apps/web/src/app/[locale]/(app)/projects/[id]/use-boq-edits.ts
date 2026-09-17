'use client';

import { useCallback, useState } from 'react';
import type { CellEdits, Column } from './boq-sheet-columns';

/**
 * Everything the BOQ sheet holds LOCALLY while a studio types. No server call
 * lives here — writes are use-boq-writes.ts — and no derived READ lives here
 * either: `cellValueOf` and `amountOf` are pure functions in
 * boq-sheet-columns.ts, so a row can run them over its own props.
 *
 * Local edits OVERRIDE rather than MIRROR the record. Mirroring would mean a save
 * landing from another tab is fought over; overriding means only the cells
 * actually being typed in are held locally, and everything else is whatever the
 * revalidated props say.
 *
 * THE STATE IS HANDED OUT AS DATA AND EVERY HANDLER IS STABLE — `useCallback`
 * with no dependency, state reached through the updater form. That is what makes
 * `React.memo` on a row work: a keystroke changes ONE row's slice of `cells`, so
 * every other row is handed identical props and does not re-render. While this
 * returned a fresh closure per member per render, memo was a no-op and one
 * keystroke on a 2,000-line sheet re-rendered all 2,000 rows.
 */
export interface BoqEditsApi {
  /** lineId -> column -> what the studio typed but has not committed. */
  cells: CellEdits;
  /** The rows mid-save. Drives the per-row spinner. */
  savingIds: ReadonlySet<string>;
  /** How many rows are mid-save. Drives the "saving"/"all saved" footer light. */
  savingCount: number;
  setCell(lineId: string, column: Column, value: string): void;
  clearColumns(lineId: string, columns: Column[]): void;
  markSaving(lineId: string, saving: boolean): void;
  /** Local edit of the document discount — same override rule as a cell. */
  discount: string | null;
  setDiscount(value: string | null): void;
}

function withCell(edits: CellEdits, lineId: string, column: Column, value: string): CellEdits {
  return { ...edits, [lineId]: { ...(edits[lineId] ?? {}), [column]: value } };
}

/** Drop named columns from one row, and the row itself once it holds nothing. */
function withoutColumns(edits: CellEdits, lineId: string, columns: Column[]): CellEdits {
  const row = { ...(edits[lineId] ?? {}) };
  for (const column of columns) delete row[column];
  const next = { ...edits };
  if (Object.keys(row).length === 0) delete next[lineId];
  else next[lineId] = row;
  return next;
}

function withSaving(saving: Set<string>, lineId: string, on: boolean): Set<string> {
  const next = new Set(saving);
  if (on) next.add(lineId);
  else next.delete(lineId);
  return next;
}

export function useBoqEdits(): BoqEditsApi {
  const [cells, setCells] = useState<CellEdits>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [discount, setDiscount] = useState<string | null>(null);

  const setCell = useCallback((lineId: string, column: Column, value: string) => {
    setCells((previous) => withCell(previous, lineId, column, value));
  }, []);

  const clearColumns = useCallback((lineId: string, columns: Column[]) => {
    setCells((previous) => withoutColumns(previous, lineId, columns));
  }, []);

  const markSaving = useCallback((lineId: string, saving: boolean) => {
    setSavingIds((previous) => withSaving(previous, lineId, saving));
  }, []);

  return {
    cells,
    savingIds,
    savingCount: savingIds.size,
    setCell,
    clearColumns,
    markSaving,
    discount,
    setDiscount,
  };
}
