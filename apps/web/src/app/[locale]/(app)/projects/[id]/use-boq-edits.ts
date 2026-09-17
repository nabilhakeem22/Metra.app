'use client';

import { useState } from 'react';
import { computeLine } from '@/lib/aggregates/proposal-totals';
import { recordValue, type Column, type EditableLine } from './boq-sheet-columns';

/** lineId -> column -> what the studio typed but has not committed. */
type CellEdits = Record<string, Partial<Record<Column, string>>>;

/**
 * Everything the BOQ sheet holds LOCALLY while a studio types, and every pure
 * read over it. No server call lives here — writes are use-boq-writes.ts.
 *
 * Local edits OVERRIDE rather than MIRROR the record. Mirroring would mean a save
 * landing from another tab is fought over; overriding means only the cells
 * actually being typed in are held locally, and everything else is whatever the
 * revalidated props say.
 */
export interface BoqEditsApi {
  /** True while the row has any uncommitted cell. An unsaved row gets an edge. */
  isDirty(lineId: string): boolean;
  /** How many rows are mid-save. Drives the "saving"/"all saved" footer light. */
  savingCount: number;
  isSaving(lineId: string): boolean;
  /** What a cell should show: the local edit if there is one, else the record. */
  cellValue(line: EditableLine, column: Column): string;
  /** Only what was TYPED, or undefined. A blur with nothing typed writes nothing. */
  typedValue(line: EditableLine, column: Column): string | undefined;
  amountOf(line: EditableLine): string;
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

/**
 * The amount as it will be STORED, recomputed from what is on screen.
 *
 * It runs the SAME `computeLine` the server runs, so the number the studio is
 * steering by while typing is the number that lands in the row — rather than a
 * browser-side approximation that disagrees with the document by a piastre.
 */
function amountFor(edits: CellEdits, line: EditableLine): string {
  const qty = edits[line.id]?.qty;
  const unitPrice = edits[line.id]?.unitPrice;
  if (qty === undefined && unitPrice === undefined) return line.lineTotal;
  return computeLine({
    qty: qty ?? line.qty,
    unitPrice: unitPrice ?? line.unitPrice,
    unitCost: '0',
    discountPct: line.discountPct,
  }).lineTotal;
}

export function useBoqEdits(): BoqEditsApi {
  const [edits, setEdits] = useState<CellEdits>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [discount, setDiscount] = useState<string | null>(null);

  return {
    isDirty: (lineId) => edits[lineId] !== undefined,
    savingCount: savingIds.size,
    isSaving: (lineId) => savingIds.has(lineId),
    cellValue: (line, column) => edits[line.id]?.[column] ?? recordValue(line, column),
    typedValue: (line, column) => edits[line.id]?.[column],
    amountOf: (line) => amountFor(edits, line),
    setCell: (lineId, column, value) =>
      setEdits((prev) => withCell(prev, lineId, column, value)),
    clearColumns: (lineId, columns) =>
      setEdits((prev) => withoutColumns(prev, lineId, columns)),
    markSaving: (lineId, saving) =>
      setSavingIds((prev) => withSaving(prev, lineId, saving)),
    discount,
    setDiscount,
  };
}
