'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CellEdits, Column, RowEdits } from './boq-sheet-columns';

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
  /** The rows mid-save. `.has(lineId)` drives the per-row spinner. */
  savingIds: ReadonlySet<string>;
  /** How many rows are mid-save. Drives the "saving"/"all saved" footer light. */
  savingCount: number;
  setCell(lineId: string, column: Column, value: string): void;
  /** Drop the local override outright — Escape, and a blur that changed nothing. */
  clearColumns(lineId: string, columns: Column[]): void;
  /**
   * Drop the local override for each column whose typed value is STILL the value
   * that was just saved. A cell the studio has re-typed since keeps its override:
   * the record coming back names the superseded figure, and the write carrying
   * the new one has not been sent yet.
   */
  clearSaved(lineId: string, saved: RowEdits): void;
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

/**
 * Drop only what was SAVED, leaving anything typed since. Same shape as
 * `withoutColumns`, one condition apart — and that condition is the whole of
 * wave 7 F4: the first write's success used to clear the cell outright, throwing
 * away the value a second, still-QUEUED write was carrying. The money figure on
 * screen fell back to the superseded record for a full round trip.
 */
function withoutSaved(edits: CellEdits, lineId: string, saved: RowEdits): CellEdits {
  const row = { ...(edits[lineId] ?? {}) };
  for (const [column, value] of Object.entries(saved)) {
    if (row[column as Column] === value) delete row[column as Column];
  }
  const next = { ...edits };
  if (Object.keys(row).length === 0) delete next[lineId];
  else next[lineId] = row;
  return next;
}

/**
 * SAVES IN FLIGHT PER ROW, COUNTED — not a membership set.
 *
 * As a Set this said "all saved" while a second write to the same line was still
 * in flight (W5 R6): two blurs on one row mark it saving twice and unmark it
 * twice, and the FIRST unmark deleted the id outright. The footer went green,
 * the row's spinner stopped, and a write was still on the wire. Counting makes
 * the light tell the truth, and it is what makes the cell latch visible on
 * screen at all — a queued write is a write that has not happened yet.
 *
 * Clamped at zero rather than allowed to go negative: an unbalanced unmark is a
 * bug, but a row stuck permanently "saving" because the count went to -1 and
 * back to 0 would be a worse one.
 */
function withSaving(
  saving: Map<string, number>,
  lineId: string,
  on: boolean,
): Map<string, number> {
  const next = new Map(saving);
  const inFlight = (next.get(lineId) ?? 0) + (on ? 1 : -1);
  if (inFlight > 0) next.set(lineId, inFlight);
  else next.delete(lineId);
  return next;
}

export function useBoqEdits(): BoqEditsApi {
  const [cells, setCells] = useState<CellEdits>({});
  const [saving, setSaving] = useState<Map<string, number>>(new Map());
  const [discount, setDiscount] = useState<string | null>(null);

  const setCell = useCallback((lineId: string, column: Column, value: string) => {
    setCells((previous) => withCell(previous, lineId, column, value));
  }, []);

  const clearColumns = useCallback((lineId: string, columns: Column[]) => {
    setCells((previous) => withoutColumns(previous, lineId, columns));
  }, []);

  const clearSaved = useCallback((lineId: string, saved: RowEdits) => {
    setCells((previous) => withoutSaved(previous, lineId, saved));
  }, []);

  const markSaving = useCallback((lineId: string, on: boolean) => {
    setSaving((previous) => withSaving(previous, lineId, on));
  }, []);

  // Derived, and memoised on the COUNTS — which change only when a save starts
  // or ends, never on a keystroke. A fresh Set per render would hand every row a
  // new prop and undo the `React.memo` this file exists to make work.
  const savingIds = useMemo(() => new Set(saving.keys()), [saving]);

  return {
    cells,
    savingIds,
    savingCount: savingIds.size,
    setCell,
    clearColumns,
    clearSaved,
    markSaving,
    discount,
    setDiscount,
  };
}
