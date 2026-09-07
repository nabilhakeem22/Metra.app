// PURE BOQ money engine. Deliberately thin: lines and sections are computed by
// the SAME functions the proposal and contract use, because a BOQ line becomes a
// contract line and the two must never disagree about what a line is worth.
//
// Only the document roll-up differs, and it differs by being SHORTER. A BOQ
// prices the works and nothing else — tax and supervision are added when the BOQ
// becomes an execution contract — so the chain stops at
// `total = subtotal - discountAmount` rather than running on through a taxable
// base, VAT and a supervision fee.
//
// No server-only imports: the builder's live preview runs this in the browser so
// what the studio sees while typing is what gets persisted.

import {
  computeLine,
  computeSection,
  formatMoney4,
  parseMoney4,
  pctOf,
  type LineInput,
  type LineTotals,
  type SectionTotals,
} from '@/lib/aggregates/proposal-totals';

export { computeLine, computeSection };
export type { LineInput, LineTotals, SectionTotals };

export interface BoqDocTotals {
  subtotal: string;
  discountAmount: string;
  total: string;
  totalCost: string;
  totalMargin: string;
}

/**
 * Roll section subtotals up to the document.
 *
 * `totalMargin` is measured against the DISCOUNTED total, not the gross subtotal
 * — a discount comes out of margin, never out of cost, so a studio that discounts
 * 10% should see its margin fall by that amount rather than stay flat.
 */
export function computeBoqTotals(
  sections: SectionTotals[],
  doc: { discountPct: string },
): BoqDocTotals {
  let subtotal = 0n;
  let totalCost = 0n;
  for (const s of sections) {
    subtotal += parseMoney4(s.sectionSubtotal);
    totalCost += parseMoney4(s.sectionCost);
  }

  const discountAmount = pctOf(subtotal, parseMoney4(doc.discountPct));
  const total = subtotal - discountAmount;

  return {
    subtotal: formatMoney4(subtotal),
    discountAmount: formatMoney4(discountAmount),
    total: formatMoney4(total),
    totalCost: formatMoney4(totalCost),
    totalMargin: formatMoney4(total - totalCost),
  };
}
