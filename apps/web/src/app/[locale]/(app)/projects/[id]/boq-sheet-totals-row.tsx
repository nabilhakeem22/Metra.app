'use client';

import type { CSSProperties, ReactNode } from 'react';

// ONE totals row of the sheet. Totals are ROWS OF THIS TABLE: the label spans the
// leading columns and the figure lands in the Amount column, so a grand total
// cannot drift out of the column it sums.

/**
 * ONLY the grand total pins. Sticking all the rows at bottom:0 stacks them on
 * top of each other — the first render of this sheet showed TOTAL sitting on top
 * of Subtotal and Discount, hiding both. The grand total is the figure you steer
 * by; the rows above it are reference and can scroll into view with the end of
 * the sheet.
 */
function totalsCellStyle(grand: boolean, tinted: boolean): CSSProperties {
  return {
    ...(grand ? { position: 'sticky', insetBlockEnd: 0, zIndex: 3 } : {}),
    background: tinted ? 'var(--track)' : 'hsl(var(--card))',
    borderTop: grand ? '2px solid var(--rule)' : '1px solid var(--rule-soft)',
  };
}

export function BoqTotalsRow({
  label,
  value,
  colCount,
  leading,
  tinted = false,
  grand = false,
  editor,
}: {
  label: string;
  value: string;
  colCount: number;
  /** The columns before Amount (`leadingColumnCount`). */
  leading: number;
  tinted?: boolean;
  grand?: boolean;
  /** Rendered beside the label — the discount PERCENTAGE, where the amount it
   *  produces still lands in the Amount column with everything else. */
  editor?: ReactNode;
}) {
  const cell = totalsCellStyle(grand, tinted);
  return (
    <tr>
      <td
        colSpan={leading}
        style={cell}
        className={`p-3 font-mono text-[11px] font-bold uppercase tracking-[0.09em] ${grand ? 'text-[color:var(--text)]' : 'text-[color:var(--text-faint)]'}`}
      >
        {/* Pinned inside its spanning cell for the same reason as the section
            title — a totals row whose label has scrolled away is a bare number. */}
        <span
          className="inline-flex w-fit items-center gap-2"
          style={{ position: 'sticky', insetInlineStart: 0 }}
        >
          {label}
          {editor}
        </span>
      </td>
      <td
        style={cell}
        dir="ltr"
        className={`whitespace-nowrap p-3 text-end font-mono font-bold tabular-nums text-[color:var(--text)] ${grand ? 'text-[18px]' : 'text-sm'}`}
      >
        {value}
      </td>
      <td colSpan={colCount - leading - 1} style={cell} />
    </tr>
  );
}
