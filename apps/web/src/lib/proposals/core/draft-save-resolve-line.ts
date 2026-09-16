// Stage 2b of the draft save: ONE line resolved and priced.
//
// PURE (no DB) — throws coded ActionErrors via `fail`. Where a line's unit, price
// and description come from (the line, or the price-book item it points at) and
// what its cost is allowed to be (the F1 stable-id rule) are the two decisions
// that make a saved proposal differ from what the studio typed, so they are named
// rather than inlined.
import type { CostItemUnit } from '@metra/db';
import { fail } from '@/lib/actions/mutate';
import type { LineTotals } from '@/lib/aggregates/proposal-totals';
import { readMoney } from '@/lib/money/read';
import { computeLineWithinCap } from './draft-save-caps';
import { isPercentInRange } from '@/lib/validation/percent';
import { clean } from '@/lib/validation/text';
import type { CostItemResolved } from './draft-save-cost-items';
import type { LineInput } from './types';

export interface ResolvedLine {
  costItemId: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  qty: string;
  unit: CostItemUnit;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
  lineCost: string;
  lineTotal: string;
  lineMargin: string;
  sortOrder: number;
}

/** What the line inherits from the price-book item it points at, if any. */
interface LineIdentity {
  costItemId: string | null;
  costItem: CostItemResolved | undefined;
  unit: CostItemUnit | null;
  unitPrice: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
}

function resolveLineIdentity(
  line: LineInput,
  costItemMap: Map<string, CostItemResolved>,
): LineIdentity {
  const costItemId = line.costItemId?.trim() || null;
  const costItem = costItemId ? costItemMap.get(costItemId) : undefined;
  return {
    costItemId,
    costItem,
    unit: line.unit ?? costItem?.unit ?? null,
    unitPrice: line.unitPrice ?? costItem?.defaultUnitPrice ?? null,
    descriptionEn: clean(line.descriptionEn) ?? costItem?.nameEn ?? null,
    descriptionAr: clean(line.descriptionAr) ?? costItem?.nameAr ?? null,
  };
}

/**
 * F1 cost resolution BY STABLE IDENTITY.
 *
 * An EXISTING line keeps its stored cost unless a margin-visible caller sent a
 * new one — which is what stops a project manager who cannot see cost from
 * silently zeroing it just by saving the page they are allowed to edit. A NEW
 * line takes the price book's cost, or the caller's, or zero.
 */
function resolveLineCost(
  line: LineInput,
  identity: LineIdentity,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): string | null {
  const lineId = line.id?.trim() || null;
  const storedCost = lineId ? costSnapshot.get(lineId) : undefined;
  if (storedCost !== undefined) {
    return seeMargin ? (line.unitCost ?? storedCost) : storedCost;
  }
  if (identity.costItemId) return identity.costItem!.defaultUnitCost;
  return seeMargin ? line.unitCost || '0' : '0';
}

/** The four priced figures, read. Range-checking the discount is the CALLER's
 *  job, because its position among the other refusals is observable. */
function readLineFactors(
  line: LineInput,
  identity: LineIdentity,
  rawCost: string | null,
): { qty: string; unitCost: string; unitPrice: string; discountPct: string } {
  const qty = readMoney(line.qty, { blank: '0' });
  const unitCost = readMoney(rawCost, { blank: '0' });
  const unitPrice = readMoney(identity.unitPrice, { blank: '0' });
  const discountPct = readMoney(line.discountPct, { blank: '0' });
  const factors = [qty, unitCost, unitPrice, discountPct];
  if (!qty.ok || !unitCost.ok || !unitPrice.ok || !discountPct.ok) {
    // A factor PAST THE CAP says so. It reached here as a plain `line_required`
    // — "this line is missing something" for a line whose problem was that one
    // of its numbers is 1e13.
    const tooLarge = factors.some((f) => !f.ok && f.reason === 'too_large');
    fail(tooLarge ? 'amount_too_large' : 'line_required');
  }
  return {
    qty: qty.value,
    unitCost: unitCost.value,
    unitPrice: unitPrice.value,
    discountPct: discountPct.value,
  };
}

/**
 * One draft line, resolved and priced. `sortOrder` falls back to its position.
 *
 * The refusal ORDER is observable and unchanged: a missing figure, then a missing
 * unit or description, then an out-of-range discount, then an overflowing product.
 */
export function resolveDraftLine(
  line: LineInput,
  index: number,
  costItemMap: Map<string, CostItemResolved>,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): { line: ResolvedLine; totals: LineTotals } {
  const identity = resolveLineIdentity(line, costItemMap);
  const rawCost = resolveLineCost(line, identity, costSnapshot, seeMargin);
  const factors = readLineFactors(line, identity, rawCost);
  if (!identity.unit || (!identity.descriptionEn && !identity.descriptionAr)) {
    fail('line_required');
  }
  if (!isPercentInRange(factors.discountPct)) fail('discount_out_of_range');
  const totals = computeLineWithinCap(factors);
  return {
    totals,
    line: {
      costItemId: identity.costItemId,
      descriptionAr: identity.descriptionAr,
      descriptionEn: identity.descriptionEn,
      unit: identity.unit,
      sortOrder: line.sortOrder ?? index,
      ...factors,
      ...totals,
    },
  };
}
