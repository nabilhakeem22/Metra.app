'use client';

import { useTranslations } from 'next-intl';
import type { KeyboardEvent } from 'react';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { describeFieldError } from '@/lib/actions/field-error-message';
import type { Column, EditableLine } from './boq-sheet-columns';
import type { BoqSheetRowApi } from './boq-sheet-row-api';
import type { BoqRowRefusals } from './use-boq-cell-errors';

// The BOQ sheet's TYPED cell: the input itself, and its refusal under it.

const CELL_INPUT_CLASS =
  'w-full rounded-item border border-transparent bg-transparent p-3 field-text text-[color:var(--text)] outline-none hover:bg-[color:var(--track)] focus-visible:border-[color:hsl(var(--brand))] focus-visible:bg-[color:var(--field-bg)]';

/**
 * One editable cell of the sheet. `data-col` is what Enter walks down — see
 * boq-sheet-focus.ts — so it is load-bearing, not a styling hook. A refused
 * cell is marked and its sentence said under it (`refusal`, resolved).
 */
export function BoqCellInput({
  id,
  value,
  onChange,
  onBlur,
  onKeyDown,
  column,
  label,
  mono,
  numeric,
  refusal,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  column: Column;
  label: string;
  mono?: boolean;
  numeric?: boolean;
  refusal?: string;
}) {
  return (
    <>
      <input
        id={id}
        value={value}
        data-col={column}
        aria-label={label}
        aria-invalid={refusal ? true : undefined}
        aria-describedby={refusal ? fieldErrorId(id) : undefined}
        dir={numeric ? 'ltr' : 'auto'}
        inputMode={numeric ? 'decimal' : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={`${CELL_INPUT_CLASS} ${mono ? 'font-mono tabular-nums' : ''} ${numeric ? 'text-end' : ''}`}
      />
      <FieldErrorText id={fieldErrorId(id)} message={refusal} />
    </>
  );
}

/**
 * The four TYPED columns differ only in their label and their shape, so they
 * share one input rather than four near-identical copies of the same six props.
 */
export function EditableCell({
  line,
  column,
  label,
  value,
  api,
  mono,
  numeric,
  refusal,
}: {
  line: EditableLine;
  column: Column;
  label: string;
  /** What this cell SHOWS, resolved by the row from its own props (cellValueOf).
   *  Passed in rather than read back out of a shared api, so the api can stay
   *  stable and the row can be memoised. */
  value: string;
  api: BoqSheetRowApi;
  mono?: boolean;
  numeric?: boolean;
  refusal?: string;
}) {
  return (
    <BoqCellInput
      id={boqCellId(line.id, column)}
      value={value}
      onChange={(value) => api.setCell(line.id, column, value)}
      onBlur={() => api.onCellBlur(line, column)}
      onKeyDown={(event) => api.onKeyDown(event, line, column)}
      column={column}
      label={label}
      mono={mono}
      numeric={numeric}
      refusal={refusal}
    />
  );
}

/** One cell's id: what its refusal is tied to. */
export const boqCellId = (lineId: string, column: Column) => `boq-${lineId}-${column}`;

/** The sentence under a refused cell, or nothing. */
export function useCellRefusal(refused: BoqRowRefusals | undefined, column: Column): string | undefined {
  const te = useTranslations('errors');
  const error = refused?.[column];
  return error ? describeFieldError(error, te) : undefined;
}
