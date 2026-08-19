import type { CostItem } from '@metra/db';
import { toIso } from './shared';

/**
 * Public v1 shape for a price-book cost item. `default_unit_cost` (the firm's cost
 * basis) is present ONLY when the caller's key resolves to a role that can see
 * margin — otherwise the key is entirely absent from the payload (not null).
 */
export interface PublicCostItem {
  id: string;
  code: string;
  name_ar: string | null;
  name_en: string | null;
  section_id: string;
  unit: string;
  default_unit_price: string;
  default_unit_cost?: string;
  tax_code: string | null;
  eta_item_code: string | null;
  eta_code_type: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export function serializeCostItem(
  row: CostItem,
  costVisible: boolean,
): PublicCostItem {
  const out: PublicCostItem = {
    id: row.id,
    code: row.code,
    name_ar: row.nameAr,
    name_en: row.nameEn,
    section_id: row.sectionId,
    unit: row.unit,
    default_unit_price: row.defaultUnitPrice,
    tax_code: row.taxCode,
    eta_item_code: row.etaItemCode,
    eta_code_type: row.etaCodeType,
    active: row.active,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
  if (costVisible) out.default_unit_cost = row.defaultUnitCost;
  return out;
}
