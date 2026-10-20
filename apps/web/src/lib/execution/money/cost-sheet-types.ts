// The cost sheet's shapes (كشف التكلفة): what its SQL aggregates hand the
// pure builder (./cost-sheet.ts), and what it gives back. PURE and CLIENT-SAFE.

/** The sections listed one by one; the rest are folded into one row in SQL (cost-sheet/queries.ts). */
export const COST_SHEET_SECTIONS_CAP = 200;

export interface CostSheetSectionInput {
  sectionId: string;
  titleAr: string | null;
  titleEn: string | null;
  /** Σ line_cost of the section's contract lines. */
  budgetCost: string;
  /** Σ line_cost of approved change-order lines on the section's lines (a de-scope lowers it). */
  variationBudgetCost: string;
  actualCost: string;
}

/** The sections past the cap, summed in SQL, each still counted by the per-section rule. */
export interface FoldedSectionsInput {
  count: number;
  /** Their budgets, change-order budgets included. */
  budgetCost: string;
  actualCost: string;
  /** Σ over them of max(budget + change-order budget, actual). */
  projectedCost: string;
}

export interface CostSheetInput {
  originalValue: string;
  taxAmount: string;
  taxRate: string;
  supervisionPct: string;
  approvedVariationNetDeltas: string[];
  sections: CostSheetSectionInput[];
  /** Null when every section is listed. */
  moreSections: FoldedSectionsInput | null;
  /** Σ line_cost of approved change-order lines on no contract line. */
  newScopeVariationsCost: string;
  /** Σ live cost entries booked against no section. */
  unallocatedActualCost: string;
  /** Σ issued (not void) payment requests, and Σ payments against them. */
  requestedTotal: string;
  paidTotal: string;
}

export type CostSheetRowKind = 'section' | 'more_sections' | 'whole_contract' | 'change_orders';

export interface CostSheetRow {
  kind: CostSheetRowKind;
  sectionId: string | null;
  titleAr: string | null;
  titleEn: string | null;
  /** How many sections a `more_sections` row folds; null on every other row. */
  count: number | null;
  /** A section's budget includes its change-order budget. Null on the whole-contract row: no budget is set against cost booked to no section. */
  budgetCost: string | null;
  /** Null on the change-orders row: cost entries are booked to sections, never to it. */
  actualCost: string | null;
  /** actual - budget, above zero is over budget; null where either is. */
  variance: string | null;
  overBudget: boolean;
}

/** What the sheet says of cost: only to a reader who may see cost and margin. */
export interface CostSheetCost {
  value: { originalValue: string; approvedVariations: string; revisedValue: string; valueExVat: string };
  sections: CostSheetRow[];
  totals: { budgetCost: string; actualCost: string };
  margin: { planned: string; projected: string; plannedPct: number | null; projectedPct: number | null };
}

export interface CostSheet {
  billing: { requested: string; paid: string; outstanding: string };
  /**
   * Null unless the reader may see cost and margin (`canSeeMargin`): a project
   * manager in a studio that hides margin from PMs gets billing only, with no
   * value before VAT, budget, actual cost or variance to subtract a margin from
   * (A5 fix round, F10 and S1), as the contract page hides cost from them.
   */
  cost: CostSheetCost | null;
}
