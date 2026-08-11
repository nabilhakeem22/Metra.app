import type { CostItemCategory, CostItemUnit } from '@metra/db';

/** Serialized cost item passed from the server page to the client. */
export interface PriceBookItem {
  id: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  category: CostItemCategory;
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  taxCode: string | null;
  etaItemCode: string | null;
  etaCodeType: string | null;
  active: boolean;
}
