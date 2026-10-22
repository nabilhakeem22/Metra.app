// The cost entries (المصروفات) of an execution contract as the Costs tab reads
// them. Plain types and the categories, CLIENT-SAFE: the server query
// (./queries.ts) builds them, the tab and its form render them. Money is a
// scale-4 string, a day is 'YYYY-MM-DD'.
import type { ContractStatus, CostCategory, CostItemUnit } from '@metra/db';

/** The six fixed categories (A15), in the order the form offers them. Equal to COST_CATEGORIES (types.test.ts). */
export const COST_ENTRY_CATEGORIES: readonly CostCategory[] = [
  'materials',
  'labour',
  'subcontractor',
  'equipment',
  'transport',
  'other',
];

/** The most entries one list answer carries; the rest load a page at a time. */
export const COST_ENTRIES_PAGE_SIZE = 50;

/** The earliest day a cost may be dated (and a list cursor may name): no studio books costs from before 2000. */
export const EARLIEST_COST_DAY = '2000-01-01';

/**
 * The official guide price of the entry's price-book item, shown for reference
 * only: present only when that item is linked to a market item whose studio
 * unit is the entry's unit and which has a price. Never stored.
 */
export interface CostEntryMarketReference {
  /** The market's unit cost in the entry's unit. */
  unitCost: string;
  /** "5.0" = the entry's unit cost is 5% above the market price; "-3.4" below. */
  variancePct: string;
}

export interface CostEntryRow {
  id: string;
  category: CostCategory;
  description: string;
  amount: string;
  incurredOn: string;
  qty: string | null;
  unit: CostItemUnit | null;
  unitCost: string | null;
  supplier: string | null;
  reference: string | null;
  /** Null for the whole contract. */
  contractSectionId: string | null;
  sectionTitleAr: string | null;
  sectionTitleEn: string | null;
  /** Null for a whole section (or the whole contract). */
  contractLineId: string | null;
  lineDescriptionAr: string | null;
  lineDescriptionEn: string | null;
  costItemId: string | null;
  costItemCode: string | null;
  costItemNameAr: string | null;
  costItemNameEn: string | null;
  /** A voided entry stays listed, and counts in no total. */
  voided: boolean;
  /** This member may edit and void it: a keeper (owner, admin), or the member who recorded it (./access.ts). */
  editable: boolean;
  market: CostEntryMarketReference | null;
}

/** Where the next page starts: after this entry, in (incurred_on desc, id desc) order. */
export interface CostEntriesCursor {
  incurredOn: string;
  id: string;
}

/** What the list is narrowed to; null is "all". */
export interface CostEntriesFilter {
  category: CostCategory | null;
  sectionId: string | null;
}

export const NO_COST_FILTER: CostEntriesFilter = { category: null, sectionId: null };

/** The live (not voided) entries matching the filter, across every page. */
export interface CostEntriesTotals {
  count: number;
  amount: string;
}

/**
 * Whose entries a member lists (owner ruling, Oct 21): `all` for a member who
 * may see margin, `own` (only the entries it recorded, and no totals) for one
 * who may not, so no job cost is there to subtract from the contract value.
 */
export type CostEntriesScope = 'all' | 'own';

export interface CostEntriesPage {
  entries: CostEntryRow[];
  /** The cursor of the next page; null on the last one. */
  next: CostEntriesCursor | null;
  /** Read with the first page only, and only in the `all` scope; otherwise null. */
  totals: CostEntriesTotals | null;
  scope: CostEntriesScope;
}

/** The costs page's contract header: what it is and where it stands, and no money. */
export interface CostContractHeader {
  id: string;
  number: number;
  /** ISO timestamp: the document number's year. */
  createdAt: string;
  titleAr: string | null;
  titleEn: string | null;
  status: ContractStatus;
  clientNameAr: string | null;
  clientNameEn: string | null;
}

/** A section a cost is booked to or filtered by: its titles, and no money. */
export interface CostSection {
  id: string;
  titleAr: string | null;
  titleEn: string | null;
}

/** At most one page of sections, in document order, and whether more follow. */
export interface CostSectionsPage {
  sections: CostSection[];
  hasMore: boolean;
}
