// The numeric(18,4) overflow guards, at all three levels of a priced document.
//
// PURE — throws coded ActionErrors via `fail`. They live together because they
// are ONE rule applied three times, and because each was previously written
// beside the code it guarded, where the reason the next one is not implied by
// the last had to be re-explained every time.
//
// Why three: every FACTOR can be inside the cap while the PRODUCT is not (qty and
// unit_price of 1e12 each pass and multiply to 1e24); every LINE can be inside it
// while the SECTION sum is not; every section can be inside it while the DOCUMENT
// total is not. Each level is persisted, so each level is checked — and a sum
// past the cap that reaches numeric(18,4) comes back as an unlocalizable
// 'generic' instead of a coded refusal.
import { fail } from '@/lib/actions/mutate';
import {
  computeLine,
  computeSection,
  computeTotals,
  type DocInput,
  type DocTotals,
  type LineTotals,
  type SectionTotals,
} from '@/lib/aggregates/proposal-totals';
import { withinMagnitude } from '@/lib/money/read';

/**
 * A line's three PERSISTED products. All three are checked, not just the total: a
 * cheap price with an absurd cost overflows line_cost (and line_margin with it)
 * exactly the same way, and only the document total used to catch that — after
 * the lines had already been written.
 */
export function computeLineWithinCap(factors: {
  qty: string;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
}): LineTotals {
  const totals = computeLine(factors);
  if (
    !withinMagnitude(totals.lineTotal) ||
    !withinMagnitude(totals.lineCost) ||
    !withinMagnitude(totals.lineMargin)
  ) {
    fail('amount_too_large');
  }
  return totals;
}

/**
 * A section's sums. Checked at resolve time rather than beside the document
 * total, because the section subtotal is PERSISTED first and would reach the
 * column before the document total was ever computed.
 */
export function computeSectionWithinCap(lineTotals: LineTotals[]): SectionTotals {
  const totals = computeSection(lineTotals);
  if (
    !withinMagnitude(totals.sectionSubtotal) ||
    !withinMagnitude(totals.sectionCost) ||
    !withinMagnitude(totals.sectionMargin)
  ) {
    fail('amount_too_large');
  }
  return totals;
}

/** The document's own total and cost, after discount, tax and supervision. */
export function computeTotalsWithinCap(
  sectionTotals: SectionTotals[],
  header: DocInput,
): DocTotals {
  const totals = computeTotals(sectionTotals, header);
  if (!withinMagnitude(totals.total) || !withinMagnitude(totals.totalCost)) {
    fail('amount_too_large');
  }
  return totals;
}
