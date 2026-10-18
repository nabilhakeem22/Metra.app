// The one-page cost sheet (كشف التكلفة) of an execution contract: value,
// billing, budget against actual cost per section, and the margin. PURE and
// CLIENT-SAFE; the query hands it SQL aggregates (bounded rows), this does the
// BigInt money (plan A17).
//
//   budget            = Σ contract line_cost + Σ approved change-order line_cost
//   value ex VAT      = original_value - tax_amount + Σ approved orders (works + supervision)
//   planned margin    = value ex VAT - budget
//   projected margin  = value ex VAT - Σ per row max(budget, actual)
// Costs booked against the whole contract sit in their own row (budget 0), so
// they count in full; the change-order budget sits in another (actual 0).
import { formatMoney4, marginPct, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { variationCharge } from './variation-charge';

export interface CostSheetSectionInput {
  sectionId: string;
  titleAr: string | null;
  titleEn: string | null;
  budgetCost: string;
  actualCost: string;
}

export interface CostSheetInput {
  originalValue: string;
  taxAmount: string;
  taxRate: string;
  supervisionPct: string;
  approvedVariationNetDeltas: string[];
  /** Σ line_cost of the approved change orders' lines. */
  approvedVariationsCost: string;
  sections: CostSheetSectionInput[];
  /** Σ live cost entries booked against no section. */
  unallocatedActualCost: string;
  /** Σ issued (not void) payment requests, and Σ payments against them. */
  requestedTotal: string;
  paidTotal: string;
}

export type CostSheetRowKind = 'section' | 'whole_contract' | 'change_orders';

export interface CostSheetRow {
  kind: CostSheetRowKind;
  sectionId: string | null;
  titleAr: string | null;
  titleEn: string | null;
  budgetCost: string;
  actualCost: string;
  /** actual - budget: above zero is over budget. */
  variance: string;
  overBudget: boolean;
}

export interface CostSheet {
  value: { originalValue: string; approvedVariations: string; revisedValue: string; valueExVat: string };
  billing: { requested: string; paid: string; outstanding: string };
  sections: CostSheetRow[];
  totals: { budgetCost: string; actualCost: string };
  margin: null | { planned: string; projected: string; plannedPct: number | null; projectedPct: number | null };
}

interface CostRowFigures {
  sectionId: string | null;
  titleAr: string | null;
  titleEn: string | null;
  budgetCost: string;
  actualCost: string;
}

function costRow(kind: CostSheetRowKind, figures: CostRowFigures): CostSheetRow {
  const budget4 = parseMoney4(figures.budgetCost);
  const actual4 = parseMoney4(figures.actualCost);
  return {
    kind,
    sectionId: figures.sectionId,
    titleAr: figures.titleAr,
    titleEn: figures.titleEn,
    budgetCost: formatMoney4(budget4),
    actualCost: formatMoney4(actual4),
    variance: formatMoney4(actual4 - budget4),
    overBudget: actual4 > budget4,
  };
}

/** The section rows, then "whole contract" and "change orders" when they hold money. */
function costRows(input: CostSheetInput): CostSheetRow[] {
  const rows = input.sections.map((section) => costRow('section', section));
  const untitled = { sectionId: null, titleAr: null, titleEn: null };
  if (parseMoney4(input.unallocatedActualCost) !== 0n) {
    rows.push(costRow('whole_contract', { ...untitled, budgetCost: '0', actualCost: input.unallocatedActualCost }));
  }
  if (parseMoney4(input.approvedVariationsCost) !== 0n) {
    rows.push(costRow('change_orders', { ...untitled, budgetCost: input.approvedVariationsCost, actualCost: '0' }));
  }
  return rows;
}

function sum4(values: string[]): bigint {
  return values.reduce((total, value) => total + parseMoney4(value), 0n);
}

/** The contract value, with the approved change orders' charges. */
function contractValue(input: CostSheetInput): CostSheet['value'] {
  const charges = input.approvedVariationNetDeltas.map((netDelta) =>
    variationCharge(netDelta, input.taxRate, input.supervisionPct),
  );
  const original4 = parseMoney4(input.originalValue);
  const variations4 = sum4(charges.map((charge) => charge.total));
  const variationsExVat4 = sum4(charges.flatMap((charge) => [charge.works, charge.supervision]));
  return {
    originalValue: formatMoney4(original4),
    approvedVariations: formatMoney4(variations4),
    revisedValue: formatMoney4(original4 + variations4),
    valueExVat: formatMoney4(original4 - parseMoney4(input.taxAmount) + variationsExVat4),
  };
}

/** Planned against the budget; projected against the larger of budget and actual per row. */
function contractMargin(valueExVat: string, rows: CostSheetRow[]): NonNullable<CostSheet['margin']> {
  const value4 = parseMoney4(valueExVat);
  const exposure4 = rows.reduce((total, row) => {
    const budget4 = parseMoney4(row.budgetCost);
    const actual4 = parseMoney4(row.actualCost);
    return total + (actual4 > budget4 ? actual4 : budget4);
  }, 0n);
  const planned = formatMoney4(value4 - sum4(rows.map((row) => row.budgetCost)));
  const projected = formatMoney4(value4 - exposure4);
  return { planned, projected, plannedPct: marginPct(planned, valueExVat), projectedPct: marginPct(projected, valueExVat) };
}

/** The cost sheet; `margin` is null unless the reader may see margin (`canSeeMargin`). */
export function buildCostSheet(input: CostSheetInput, canSeeMargin: boolean): CostSheet {
  const value = contractValue(input);
  const rows = costRows(input);
  const requested4 = parseMoney4(input.requestedTotal);
  const paid4 = parseMoney4(input.paidTotal);
  return {
    value,
    billing: {
      requested: formatMoney4(requested4),
      paid: formatMoney4(paid4),
      outstanding: formatMoney4(requested4 - paid4),
    },
    sections: rows,
    totals: {
      budgetCost: formatMoney4(sum4(rows.map((row) => row.budgetCost))),
      actualCost: formatMoney4(sum4(rows.map((row) => row.actualCost))),
    },
    margin: canSeeMargin ? contractMargin(value.valueExVat, rows) : null,
  };
}
