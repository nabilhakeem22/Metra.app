// Shared view-model types for the contract detail + variation-order UI
// (server-safe: types only).
import type { CostItemUnit } from '@metra/db';
import type { ActionResult } from '@/lib/actions/result';

export interface DraftVoLine {
  /** The row's own key: its refusals stay on it when another row is removed. */
  key: string;
  contractLineId: string;
  /** What the picked contract line reads as, kept so it shows after another search. */
  contractLineLabel: string;
  /** Saved in the column of the page's language (use-variation-create.ts). */
  description: string;
  qty: string;
  unit: CostItemUnit;
  unitPrice: string;
  discountPct: string;
}

/**
 * What an execution contract charges on top of a change order's works (D4a):
 * its VAT and supervision rates. Null on a proposal contract, whose register
 * shows the net change alone, as before Stage 2.
 */
export interface VariationChargeRates {
  taxRate: string;
  supervisionPct: string;
}

/** Runs a server action, refreshing on success and saying why it failed. */
export type ContractAction = (fn: () => Promise<ActionResult>) => void;
