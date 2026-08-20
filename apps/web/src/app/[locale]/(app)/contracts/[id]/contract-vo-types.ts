// Shared view-model types for the contract detail + variation-order UI
// (server-safe: types only).
import type { CostItemUnit } from '@metra/db';

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

/** Runs a server action, refreshing on success and surfacing a coded error. */
export type ContractAction = (
  fn: () => Promise<{ ok: boolean; error?: string; link?: string }>,
) => void;
