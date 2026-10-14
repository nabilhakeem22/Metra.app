// The cost-item form's fields and the input its actions take. A plain module
// (types and one tuple), so the client form, the pure rules and the server
// core share it.
import type { CostItemUnit } from '@metra/db';

/** Every path a cost-item refusal can name; `name` is the Arabic/English pair. */
export const COST_ITEM_FIELDS = [
  'code',
  'name',
  'sectionId',
  'unit',
  'defaultUnitCost',
  'defaultUnitPrice',
  'taxCode',
  'etaItemCode',
  'etaCodeType',
] as const;

export type CostItemField = (typeof COST_ITEM_FIELDS)[number];

export interface CostItemInput {
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  sectionId: string;
  unit: CostItemUnit;
  defaultUnitCost?: string | null;
  defaultUnitPrice?: string | null;
  taxCode?: string | null;
  etaItemCode?: string | null;
  etaCodeType?: string | null;
}
