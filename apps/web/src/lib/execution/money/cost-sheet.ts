// The one-page cost sheet (كشف التكلفة) of an execution contract: value,
// billing, budget against actual cost per section, and the margin. PURE and
// CLIENT-SAFE; the query hands it SQL aggregates (bounded rows), this does the
// BigInt money (plan A17).
//
//   budget            = Σ contract line_cost + Σ approved change-order line_cost
//   value ex VAT      = original_value - tax_amount + Σ approved orders (works + supervision)
//   planned margin    = value ex VAT - budget
//   projected margin  = value ex VAT - projected cost, PER SECTION (owner decision Oct 19):
//     each section counts max(its budget + its change-order budget, its actual);
//     change-order lines on no contract line (new scope) count max(their budget, 0);
//     actual cost booked to no section counts as it is.
// A change-order line on a contract line takes that line's section, so its
// budget sits in that section's row; the new-scope ones form the "change
// orders" row, which takes no cost entries.
import { formatMoney4, marginPct, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { CostSheet, CostSheetInput, CostSheetRow, CostSheetRowKind, CostSheetSectionInput } from './cost-sheet-types';
import { approvedVariationsCharge, variationCharge } from './variation-charge';

const max4 = (a: bigint, b: bigint) => (a > b ? a : b);
const sum4 = (values: (string | null)[]) => values.reduce((total, value) => total + parseMoney4(value), 0n);
const UNTITLED = { sectionId: null, titleAr: null, titleEn: null, count: null };

function costRow(kind: CostSheetRowKind, row: Omit<CostSheetRow, 'kind' | 'variance' | 'overBudget'>): CostSheetRow {
  const budget4 = parseMoney4(row.budgetCost);
  const actual4 = row.actualCost === null ? null : parseMoney4(row.actualCost);
  return {
    kind,
    ...row,
    budgetCost: formatMoney4(budget4),
    actualCost: actual4 === null ? null : formatMoney4(actual4),
    variance: actual4 === null ? null : formatMoney4(actual4 - budget4),
    overBudget: actual4 !== null && actual4 > budget4,
  };
}

const sectionBudget4 = (section: CostSheetSectionInput) =>
  parseMoney4(section.budgetCost) + parseMoney4(section.variationBudgetCost);

/** The section rows, the folded rest, then "whole contract" and "change orders" when they hold money. */
function costRows(input: CostSheetInput): CostSheetRow[] {
  const rows = input.sections.map((section) =>
    costRow('section', {
      sectionId: section.sectionId,
      titleAr: section.titleAr,
      titleEn: section.titleEn,
      count: null,
      budgetCost: formatMoney4(sectionBudget4(section)),
      actualCost: section.actualCost,
    }),
  );
  const more = input.moreSections;
  if (more) rows.push(costRow('more_sections', { ...UNTITLED, count: more.count, budgetCost: more.budgetCost, actualCost: more.actualCost }));
  if (parseMoney4(input.unallocatedActualCost) !== 0n) {
    rows.push(costRow('whole_contract', { ...UNTITLED, budgetCost: '0', actualCost: input.unallocatedActualCost }));
  }
  if (parseMoney4(input.newScopeVariationsCost) !== 0n) {
    rows.push(costRow('change_orders', { ...UNTITLED, budgetCost: input.newScopeVariationsCost, actualCost: null }));
  }
  return rows;
}

/** The contract value, with the approved change orders' charges, each rounded as it is billed. */
function contractValue(input: CostSheetInput): CostSheet['value'] {
  const original4 = parseMoney4(input.originalValue);
  const variations4 = parseMoney4(approvedVariationsCharge(input.approvedVariationNetDeltas, input.taxRate, input.supervisionPct));
  const variationsExVat4 = sum4(
    input.approvedVariationNetDeltas.flatMap((netDelta) => {
      const charge = variationCharge(netDelta, input.taxRate, input.supervisionPct);
      return [charge.works, charge.supervision];
    }),
  );
  return {
    originalValue: formatMoney4(original4),
    approvedVariations: formatMoney4(variations4),
    revisedValue: formatMoney4(original4 + variations4),
    valueExVat: formatMoney4(original4 - parseMoney4(input.taxAmount) + variationsExVat4),
  };
}

/** The per-section rule: what the contract is projected to cost. */
function projectedCost4(input: CostSheetInput): bigint {
  const sections4 = input.sections.reduce(
    (total, section) => total + max4(sectionBudget4(section), parseMoney4(section.actualCost)),
    0n,
  );
  const folded4 = parseMoney4(input.moreSections?.projectedCost ?? '0');
  return sections4 + folded4 + max4(parseMoney4(input.newScopeVariationsCost), 0n) + parseMoney4(input.unallocatedActualCost);
}

function contractMargin(input: CostSheetInput, valueExVat: string, budgetCost: string): NonNullable<CostSheet['margin']> {
  const value4 = parseMoney4(valueExVat);
  const planned = formatMoney4(value4 - parseMoney4(budgetCost));
  const projected = formatMoney4(value4 - projectedCost4(input));
  return { planned, projected, plannedPct: marginPct(planned, valueExVat), projectedPct: marginPct(projected, valueExVat) };
}

/** The cost sheet; `margin` is null unless the reader may see margin (`canSeeMargin`). */
export function buildCostSheet(input: CostSheetInput, canSeeMargin: boolean): CostSheet {
  const value = contractValue(input);
  const rows = costRows(input);
  const requested4 = parseMoney4(input.requestedTotal);
  const paid4 = parseMoney4(input.paidTotal);
  const totals = {
    budgetCost: formatMoney4(sum4(rows.map((row) => row.budgetCost))),
    actualCost: formatMoney4(sum4(rows.map((row) => row.actualCost))),
  };
  return {
    value,
    billing: { requested: formatMoney4(requested4), paid: formatMoney4(paid4), outstanding: formatMoney4(requested4 - paid4) },
    sections: rows,
    totals,
    margin: canSeeMargin ? contractMargin(input, value.valueExVat, totals.budgetCost) : null,
  };
}
