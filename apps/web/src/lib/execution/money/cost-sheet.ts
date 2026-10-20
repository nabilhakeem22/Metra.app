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
//     change-order lines on no contract line (new scope) count at their budget, a
//     de-scope below zero included (lead ruling, A5 fix round F2): no cost entry is
//     booked to them, so max(budget, 0) could only hide a de-scope, and planned
//     must equal projected while nothing is spent;
//     actual cost booked to no section counts as it is.
// A change-order line on a contract line takes that line's section, so its
// budget sits in that section's row; the new-scope ones form the "change
// orders" row, which takes no cost entries. Cost booked to no section is the
// whole-contract row: it has no budget, so it is never over one (F5).
//
// Cost and margin are for a reader who may see margin (`canSeeMargin`); any
// other reader gets billing only (F10, S1).
import { formatMoney4, marginPct, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { CostSheet, CostSheetCost, CostSheetInput, CostSheetRow, CostSheetRowKind, CostSheetSectionInput } from './cost-sheet-types';
import { approvedVariationsCharge, variationCharge } from './variation-charge';

const max4 = (a: bigint, b: bigint) => (a > b ? a : b);
const sum4 = (values: (string | null)[]) => values.reduce((total, value) => total + parseMoney4(value), 0n);
const UNTITLED = { sectionId: null, titleAr: null, titleEn: null, count: null };

const money4OrNull = (value: string | null) => (value === null ? null : parseMoney4(value));

function costRow(kind: CostSheetRowKind, row: Omit<CostSheetRow, 'kind' | 'variance' | 'overBudget'>): CostSheetRow {
  const budget4 = money4OrNull(row.budgetCost);
  const actual4 = money4OrNull(row.actualCost);
  return {
    kind,
    ...row,
    budgetCost: budget4 === null ? null : formatMoney4(budget4),
    actualCost: actual4 === null ? null : formatMoney4(actual4),
    variance: actual4 === null || budget4 === null ? null : formatMoney4(actual4 - budget4),
    overBudget: actual4 !== null && budget4 !== null && actual4 > budget4,
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
    rows.push(costRow('whole_contract', { ...UNTITLED, budgetCost: null, actualCost: input.unallocatedActualCost }));
  }
  if (parseMoney4(input.newScopeVariationsCost) !== 0n) {
    rows.push(costRow('change_orders', { ...UNTITLED, budgetCost: input.newScopeVariationsCost, actualCost: null }));
  }
  return rows;
}

/** The contract value, with the approved change orders' charges, each rounded as it is billed. */
function contractValue(input: CostSheetInput): CostSheetCost['value'] {
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
  return sections4 + folded4 + parseMoney4(input.newScopeVariationsCost) + parseMoney4(input.unallocatedActualCost);
}

function contractMargin(input: CostSheetInput, valueExVat: string, budgetCost: string): CostSheetCost['margin'] {
  const value4 = parseMoney4(valueExVat);
  const planned = formatMoney4(value4 - parseMoney4(budgetCost));
  const projected = formatMoney4(value4 - projectedCost4(input));
  return { planned, projected, plannedPct: marginPct(planned, valueExVat), projectedPct: marginPct(projected, valueExVat) };
}

function contractCost(input: CostSheetInput): CostSheetCost {
  const value = contractValue(input);
  const sections = costRows(input);
  const totals = {
    budgetCost: formatMoney4(sum4(sections.map((row) => row.budgetCost))),
    actualCost: formatMoney4(sum4(sections.map((row) => row.actualCost))),
  };
  return { value, sections, totals, margin: contractMargin(input, value.valueExVat, totals.budgetCost) };
}

/** The cost sheet; `cost` is null unless the reader may see cost and margin (`canSeeMargin`). */
export function buildCostSheet(input: CostSheetInput, canSeeMargin: boolean): CostSheet {
  const requested4 = parseMoney4(input.requestedTotal);
  const paid4 = parseMoney4(input.paidTotal);
  return {
    billing: { requested: formatMoney4(requested4), paid: formatMoney4(paid4), outstanding: formatMoney4(requested4 - paid4) },
    cost: canSeeMargin ? contractCost(input) : null,
  };
}
