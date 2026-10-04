// LINE DISCOUNTS, SHOWN ONLY WHEN GIVEN (owner decision). PURE and CLIENT-SAFE:
// the BOQ PDF template and the BOQ sheet both read it, so the two surfaces can
// never disagree about whether a BOQ has line discounts or what they took off.
//
// The rule, for one BOQ: if no line carries a non-zero discount there is no
// discount column and no extra totals row (the layout every BOQ had before). If
// any line does, the BOQ shows a discount % column for every line, and its totals
// open with the gross and the line discounts, so that
//   gross - line discounts = subtotal,  subtotal - document discount = total
// visibly add up.
import { computeLine, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';

interface PricedLine {
  qty: string;
  unitPrice: string;
  discountPct: string;
  /** The stored, discounted line total. */
  lineTotal: string;
}

type Sections = ReadonlyArray<{ lines: ReadonlyArray<PricedLine> }>;

/** A stored zero is written several ways ('0', '0.0000'); none is a discount. */
export function isLineDiscounted(line: Pick<PricedLine, 'discountPct'>): boolean {
  return parseMoney4(line.discountPct) !== 0n;
}

/** Does ANY line of this BOQ carry a discount? Decides the whole layout. */
export function hasLineDiscounts(sections: Sections): boolean {
  return sections.some((section) => section.lines.some(isLineDiscounted));
}

export interface LineDiscountTotals {
  /** Every line at qty x unit price, before its discount. */
  gross: string;
  /** What the line discounts took off: gross minus the lines' stored totals. */
  lineDiscounts: string;
}

/**
 * The two figures the totals open with. Each line's gross is computed by the
 * SAME `computeLine` the server prices with (at 0%), and its discount is that
 * gross minus the line total AS STORED, so `gross - lineDiscounts` is exactly
 * the sum of the stored line totals, which is the BOQ's subtotal.
 */
export function lineDiscountTotals(sections: Sections): LineDiscountTotals {
  let gross = 0n;
  let discounted = 0n;
  for (const section of sections) {
    for (const line of section.lines) {
      const lineGross = parseMoney4(
        computeLine({ qty: line.qty, unitPrice: line.unitPrice, unitCost: '0', discountPct: '0' })
          .lineTotal,
      );
      gross += lineGross;
      discounted += lineGross - parseMoney4(line.lineTotal);
    }
  }
  return { gross: formatMoney4(gross), lineDiscounts: formatMoney4(discounted) };
}
