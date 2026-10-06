'use client';

import { useTranslations } from 'next-intl';
import type { BoqDetail } from '@/lib/boqs/queries';
import { lineDiscountTotals } from '@/lib/boqs/line-discounts';
import { leadingColumnCount, trimNumber } from './boq-sheet-columns';
import { BoqTotalsRow } from './boq-sheet-totals-row';

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
        className="w-12 rounded-item border border-transparent bg-transparent p-1 text-end font-mono text-body tabular-nums text-[color:var(--text)] outline-none hover:bg-[color:var(--track)] focus:border-[color:hsl(var(--brand))]"
      />
      <span aria-hidden="true">%</span>
    </>
  );
}

/** A stored zero discount is written either way round, and neither is a discount. */
function hasDiscount(boq: BoqDetail): boolean {
  return boq.discountAmount !== '0' && boq.discountAmount !== '0.0000';
}

/**
 * The sheet's totals. Without line discounts: subtotal, the document discount,
 * total (unchanged). With them (owner decision: shown only when given) the
 * totals open with the gross and what the line discounts took off, and the
 * subtotal is named "after line discounts", so every row subtracts to the next.
 */
export function BoqTotals({
  boq,
  canEdit,
  colCount,
  discounted,
  money,
  discount,
  onDiscountChange,
  onDiscountBlur,
}: {
  boq: BoqDetail;
  canEdit: boolean;
  colCount: number;
  /** Some line of this BOQ carries a discount (`hasLineDiscounts`). */
  discounted: boolean;
  money: (value: string) => string;
  /** The local override, or null when the stored percentage is the truth. */
  discount: string | null;
  onDiscountChange: (value: string) => void;
  onDiscountBlur: (typed: string) => void;
}) {
  const t = useTranslations('projects.profile.boq');
  const span = { colCount, leading: leadingColumnCount(discounted) };
  const lines = discounted ? lineDiscountTotals(boq.sections) : null;
  // An issued sheet shows the discount only when there IS one; a draft always
  // shows the row, because that row is where the percentage is typed.
  return (
    <tfoot>
      {lines && (
        <>
          <BoqTotalsRow label={t('grossBeforeDiscounts')} value={money(lines.gross)} {...span} tinted />
          <BoqTotalsRow label={t('lineDiscounts')} value={money(lines.lineDiscounts)} {...span} tinted />
        </>
      )}
      <BoqTotalsRow
        label={lines ? t('subtotalAfterLineDiscounts') : t('subtotal')}
        value={money(boq.subtotal)}
        {...span}
        tinted
      />
      {(canEdit || hasDiscount(boq)) && (
        <BoqTotalsRow
          label={t('discount')}
          value={money(boq.discountAmount)}
          {...span}
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
      <BoqTotalsRow label={t('total')} value={money(boq.total)} {...span} grand />
    </tfoot>
  );
}
