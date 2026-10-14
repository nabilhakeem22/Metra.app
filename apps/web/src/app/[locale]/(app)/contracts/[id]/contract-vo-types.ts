// Shared view-model types for the contract detail + variation-order UI
// (server-safe: types only).
import type { CostItemUnit } from '@metra/db';
import type { ActionResult } from '@/lib/actions/result';

export interface BaselineLine {
  id: string;
  label: string;
}

export interface DraftVoLine {
  contractLineId: string;
  descriptionEn: string;
  qty: string;
  unit: CostItemUnit;
  unitPrice: string;
  discountPct: string;
}

/** Runs a server action, refreshing on success and saying why it failed. */
export type ContractAction = (fn: () => Promise<ActionResult>) => void;
