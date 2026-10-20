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
  /** The market item it follows (advisory, never changes its cost or price), or null. */
  marketItemId: string | null;
}

/** A section option for the Price Book filter/group + form select. */
export interface SectionOption {
  id: string;
  key: string | null;
  nameEn: string | null;
  nameAr: string | null;
}

/** One page of the book, as the server read it (lib/price-book/page-query.ts). */
export interface PriceBookPageData {
  rows: PriceBookItem[];
  /** Matching items per section, across every page. */
  sectionCounts: Record<string, number>;
  /** Matching items, across every page. */
  matched: number;
  page: number;
  pageCount: number;
  /** Whether the book holds any item at all, whatever the filters. */
  hasAnyItem: boolean;
}
