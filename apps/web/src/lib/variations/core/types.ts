// The variation-order draft shapes: what the builder posts, and what the save
// pipeline hands the database.
//
// PURE TYPES ONLY — no `server-only`, no runtime value. They live apart from the
// core because every stage of the save (validate, persist) needs them and none of
// those stages needs the others.
import type { CostItemUnit } from '@metra/db';

export interface VariationLineInput {
  /** Baseline contract line this changes; null/absent = brand-new scope. */
  contractLineId?: string | null;
  costItemId?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  /** May be NEGATIVE for a de-scope. */
  qty?: string | null;
  unit?: CostItemUnit | null;
  unitCost?: string | null;
  unitPrice?: string | null;
  discountPct?: string | null;
  sortOrder?: number;
}

export interface SaveVariationDraftInput {
  id: string;
  header?: {
    titleAr?: string | null;
    titleEn?: string | null;
    reasonAr?: string | null;
    reasonEn?: string | null;
  };
  lines: VariationLineInput[];
}

/**
 * One line, every figure recomputed server-side and ready to insert.
 *
 * Field-for-field the insert shape minus `orgId` and `variationOrderId`, which
 * the persist stage adds — so the row that reaches the database is this object
 * plus its two owners, and nothing else can be smuggled in.
 */
export interface PreparedVariationLine {
  contractLineId: string | null;
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
