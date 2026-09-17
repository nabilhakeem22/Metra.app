'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import type { BoqDetail } from '@/lib/boqs/queries';
import { trimNumber } from './boq-sheet-columns';

// Totals are ROWS OF THIS TABLE. The grand total cannot drift out of the Amount
// column because it is in it.

/**
 * ONLY the grand total pins. Sticking all three rows at bottom:0 stacks them on
 * top of each other — the first render of this sheet showed TOTAL sitting on top
 * of Subtotal and Discount, hiding both. The grand total is the figure you steer
 * by; the two above it are reference and can scroll into view with the end of the
 * sheet.
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
  tinted = false,
  grand = false,
  editor,
}: {
  label: string;
  value: string;
  colCount: number;
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
        colSpan={5}
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
      <td colSpan={colCount - 6} style={cell} />
    </tr>
  );
}

function DiscountEditor({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: (typed: string) => void;
}) {
  const t = useTranslations('projects.profile.boq');
  return (
    <>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onBlur(event.target.value.trim())}
        aria-label={t('discountPct')}
        dir="ltr"
        inputMode="decimal"
        className="w-12 rounded-[8px] border border-transparent bg-transparent p-1 text-end font-mono text-sm tabular-nums text-[color:var(--text)] outline-none hover:bg-[color:var(--track)] focus:border-[color:hsl(var(--brand))]"
      />
      <span aria-hidden="true">%</span>
    </>
  );
}

/** A stored zero discount is written either way round, and neither is a discount. */
function hasDiscount(boq: BoqDetail): boolean {
  return boq.discountAmount !== '0' && boq.discountAmount !== '0.0000';
}

export function BoqTotals({
  boq,
  canEdit,
  colCount,
  money,
  discount,
  onDiscountChange,
  onDiscountBlur,
}: {
  boq: BoqDetail;
  canEdit: boolean;
  colCount: number;
  money: (value: string) => string;
  /** The local override, or null when the stored percentage is the truth. */
  discount: string | null;
  onDiscountChange: (value: string) => void;
  onDiscountBlur: (typed: string) => void;
}) {
  const t = useTranslations('projects.profile.boq');
  // An issued sheet shows the discount only when there IS one; a draft always
  // shows the row, because that row is where the percentage is typed.
  return (
    <tfoot>
      <BoqTotalsRow label={t('subtotal')} value={money(boq.subtotal)} colCount={colCount} tinted />
      {(canEdit || hasDiscount(boq)) && (
        <BoqTotalsRow
          label={t('discount')}
          value={money(boq.discountAmount)}
          colCount={colCount}
          tinted
          editor={
            canEdit ? (
              <DiscountEditor
                value={discount ?? trimNumber(boq.discountPct)}
                onChange={onDiscountChange}
                onBlur={onDiscountBlur}
              />
            ) : undefined
          }
        />
      )}
      <BoqTotalsRow label={t('total')} value={money(boq.total)} colCount={colCount} grand />
    </tfoot>
  );
}
