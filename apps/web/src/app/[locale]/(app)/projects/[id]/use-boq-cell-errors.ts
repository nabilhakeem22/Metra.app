'use client';

import { useCallback, useState } from 'react';
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import type { Column } from './boq-sheet-columns';

/** What the server refused in ONE row, cell by cell. */
export type BoqRowRefusals = Partial<Record<Column, FieldError>>;

const COLUMNS: readonly Column[] = ['itemCode', 'description', 'unit', 'qty', 'unitPrice'];

/**
 * The sheet's refused cells, per row. A save that is refused leaves what the
 * studio typed on screen and says why UNDER the cell, and the caret stays where
 * the studio is (an autosaving surface never moves it, D4). Typing in a cell
 * clears that cell's refusal only (D3).
 *
 * Handed out as DATA plus STABLE handlers, like use-boq-edits.ts: a row is
 * memoised and receives only its own slice.
 */
export interface BoqCellErrorsApi {
  refused: Record<string, BoqRowRefusals>;
  /** Show a row's refusals; answers whether every one of them had a cell. */
  show(lineId: string, fields: FieldErrors): boolean;
  clear(lineId: string, column: Column): void;
}

export function useBoqCellErrors(): BoqCellErrorsApi {
  const [refused, setRefused] = useState<Record<string, BoqRowRefusals>>({});

  const show = useCallback((lineId: string, fields: FieldErrors): boolean => {
    const row: BoqRowRefusals = {};
    for (const column of COLUMNS) {
      const error = fields[column];
      if (error) row[column] = error;
    }
    setRefused((current) => ({ ...current, [lineId]: row }));
    return Object.keys(row).length === Object.keys(fields).length;
  }, []);

  const clear = useCallback((lineId: string, column: Column): void => {
    setRefused((current) => {
      if (!current[lineId]?.[column]) return current;
      const row = { ...current[lineId] };
      delete row[column];
      return { ...current, [lineId]: row };
    });
  }, []);

  return { refused, show, clear };
}
