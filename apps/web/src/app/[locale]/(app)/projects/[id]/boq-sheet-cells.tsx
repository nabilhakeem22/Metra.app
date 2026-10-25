'use client';

import type { ReactNode } from 'react';

// The BOQ sheet's table cells. EVERY CELL IS THE INPUT — no drawer, no modal, no
// edit button per row: a studio pricing a fit-out is doing data entry across
// dozens or hundreds of lines, and one extra click multiplies by the row count.

/** The code and description columns stay put while the money scrolls sideways. */
type StickyColumn = 'code' | 'description';

const STICKY_OFFSET: Record<StickyColumn, number> = { code: 0, description: 72 };

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
    // A figure's header is LTR like the figures under it (the money law), so on
    // an Arabic sheet it sits over them, as the payments Amount header does.
    <th
      scope="col"
      dir={num ? 'ltr' : undefined}
      className={`sticky top-0 whitespace-nowrap bg-[color:var(--thead)] p-3 text-caption font-bold text-[color:var(--thead-ink)] ltr:font-mono ltr:uppercase ltr:tracking-[0.09em] ${num ? 'text-end' : 'text-start'}`}
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
