'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import type { Column, EditableLine } from './boq-sheet-columns';
import type { BoqSheetRowApi } from './boq-sheet-row-api';

// The BOQ sheet's table cells. EVERY CELL IS THE INPUT — no drawer, no modal, no
// edit button per row: a studio pricing a fit-out is doing data entry across
// dozens or hundreds of lines, and one extra click multiplies by the row count.

/** The code and description columns stay put while the money scrolls sideways. */
type StickyColumn = 'code' | 'description';

const STICKY_OFFSET: Record<StickyColumn, number> = { code: 0, description: 72 };

const CELL_INPUT_CLASS =
  'w-full rounded-[8px] border border-transparent bg-transparent p-3 text-sm text-[color:var(--text)] outline-none hover:bg-[color:var(--track)] focus:border-[color:hsl(var(--brand))] focus:bg-[color:var(--field-bg)]';

export function Th({
  children,
  num,
  sticky,
}: {
  children: ReactNode;
  num?: boolean;
  sticky?: StickyColumn;
}) {
  return (
    <th
      scope="col"
      className={`sticky top-0 whitespace-nowrap bg-[color:var(--thead)] p-3 font-mono text-[11px] font-bold uppercase tracking-[0.09em] text-[color:var(--thead-ink)] ${num ? 'text-end' : 'text-start'}`}
      style={{
        zIndex: sticky ? 4 : 3,
        borderBottom: '1px solid var(--thead-rule)',
        ...(sticky
          ? { position: 'sticky', insetInlineStart: STICKY_OFFSET[sticky] }
          : {}),
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  num,
  sticky,
  dirty,
}: {
  children: ReactNode;
  num?: boolean;
  sticky?: StickyColumn;
  /** An unsaved row gets an edge. Autosave with no unsaved marker is a lie. */
  dirty?: boolean;
}) {
  return (
    <td
      className={`bg-card align-middle ${num ? 'text-end' : ''}`}
      style={{
        ...(sticky
          ? {
              position: 'sticky',
              insetInlineStart: STICKY_OFFSET[sticky],
              zIndex: 1,
            }
          : {}),
        ...(dirty ? { boxShadow: 'inset 3px 0 0 var(--warn)' } : {}),
      }}
    >
      {children}
    </td>
  );
}

/**
 * One editable cell of the sheet. `data-col` is what Enter walks down — see
 * boq-sheet-focus.ts — so it is load-bearing, not a styling hook.
 */
export function BoqCellInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  column,
  label,
  mono,
  numeric,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  column: Column;
  label: string;
  mono?: boolean;
  numeric?: boolean;
}) {
  return (
    <input
      value={value}
      data-col={column}
      aria-label={label}
      dir={numeric ? 'ltr' : 'auto'}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`${CELL_INPUT_CLASS} ${mono ? 'font-mono tabular-nums' : ''} ${numeric ? 'text-end' : ''}`}
    />
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
}) {
  return (
    <BoqCellInput
      value={value}
      onChange={(value) => api.setCell(line.id, column, value)}
      onBlur={() => api.onCellBlur(line, column)}
      onKeyDown={(event) => api.onKeyDown(event, line, column)}
      column={column}
      label={label}
      mono={mono}
      numeric={numeric}
    />
  );
}
