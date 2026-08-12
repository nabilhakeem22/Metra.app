import type { CostItemUnit } from '@metra/db';

/** Serialized cost item passed from the server page to the client. */
export interface PriceBookItem {
  id: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  sectionId: string;
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  taxCode: string | null;
  etaItemCode: string | null;
  etaCodeType: string | null;
  active: boolean;
}

/** A section option for the Price Book filter/group + form select. */
export interface SectionOption {
  id: string;
  key: string | null;
  nameEn: string | null;
  nameAr: string | null;
}
