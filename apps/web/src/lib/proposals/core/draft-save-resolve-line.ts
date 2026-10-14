// Stage 2b of the draft save: ONE line resolved and priced.
//
// PURE (no DB). Where a line's unit, price and description come from (the line,
// or the price-book item it points at) and what its cost is allowed to be (the
// F1 stable-id rule) are the two decisions that make a saved proposal differ
// from what the studio typed, so they are named rather than inlined. A line the
// save cannot store comes back as every refusal under the cell it is about.
import type { CostItemUnit } from '@metra/db';
import type { LineTotals } from '@/lib/aggregates/proposal-totals';
import { lineTotalsWithinCap } from './draft-save-caps';
import { clean } from '@/lib/validation/text';
import { readLineFactors, type LineErrors } from './draft-save-line-factors';
import type { CostItemResolved } from './draft-save-cost-items';
import type { LineInput } from './types';

export interface ResolvedLine {
  /** The STORED id, kept through the rebuild so the next save finds it (F1). */
  id?: string;
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

/** The line's id when it names one of this proposal's stored lines, else null. */
function storedLineId(line: LineInput, costSnapshot: Map<string, string>): string | null {
  const lineId = typeof line.id === 'string' ? line.id.trim() : '';
  return lineId && costSnapshot.has(lineId) ? lineId : null;
}

/**
 * F1 cost resolution BY STABLE IDENTITY.
 *
 * An EXISTING line keeps its stored cost unless a margin-visible caller sent a
 * new one — which is what stops a project manager who cannot see cost from
 * silently zeroing it just by saving the page they are allowed to edit. A NEW
 * line takes the cost a margin-visible caller sent (an owner's override of the
 * price book), else the price book's, else zero.
 */
function resolveLineCost(
  line: LineInput,
  identity: LineIdentity,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): string | null {
  const lineId = storedLineId(line, costSnapshot);
  const storedCost = lineId ? costSnapshot.get(lineId) : undefined;
  if (storedCost !== undefined) {
    return seeMargin ? (line.unitCost ?? storedCost) : storedCost;
  }
  if (seeMargin && line.unitCost) return line.unitCost;
  return identity.costItemId ? identity.costItem!.defaultUnitCost : '0';
}

/** What one line resolves to: the row to store and its totals, or its refusals. */
export type ResolvedDraftLine =
  | { ok: true; line: ResolvedLine; totals: LineTotals }
  | { ok: false; errors: LineErrors };

/**
 * One draft line, resolved and priced, or every refusal under the cell it is
 * about: a figure that does not read, a missing unit or description, a discount
 * out of range; and, only once those are right, a product past the cap (said
 * under the quantity). `sortOrder` falls back to its position.
 */
export function resolveDraftLine(
  line: LineInput,
  index: number,
  costItemMap: Map<string, CostItemResolved>,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): ResolvedDraftLine {
  const identity = resolveLineIdentity(line, costItemMap);
  const rawCost = resolveLineCost(line, identity, costSnapshot, seeMargin);
  const read = readLineFactors({
    qty: line.qty,
    unitCost: rawCost,
    unitPrice: identity.unitPrice,
    discountPct: line.discountPct,
  });
  const errors: LineErrors = read.ok ? {} : { ...read.errors };
  if (!identity.unit) errors.unit = { code: 'line_required' };
  if (!identity.descriptionEn && !identity.descriptionAr) errors.description = { code: 'line_required' };
  if (!read.ok || !identity.unit || Object.keys(errors).length > 0) return { ok: false, errors };
  const { factors } = read;
  const totals = lineTotalsWithinCap(factors);
  if (!totals) return { ok: false, errors: { qty: { code: 'amount_too_large' } } };
  return {
    ok: true,
    totals,
    line: {
      id: storedLineId(line, costSnapshot) ?? undefined,
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
