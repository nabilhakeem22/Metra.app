// The market price book as the studio's screens read it. Plain types, client-
// safe: the server query (./queries.ts) builds them, the page and its client
// components render them. Months are 'YYYY-MM'; prices are scale-4 strings.
import type { MarketItemStatus, MarketUnit } from '@metra/db';
import type { MarketVarianceReason } from './variance';

/** One month of an item's EFFECTIVE price: what the newest published bulletin reporting that month says. */
export interface MarketPoint {
  month: string;
  status: 'priced' | 'suspended';
  /** Null exactly when the month is suspended («التسعير متوقف»). */
  price: string | null;
  /** The bulletin the figure comes from. */
  bulletinMonth: string;
  /** The bulletin page it is printed on. */
  sourcePage: number;
}

/** Computed changes of the latest month, to 1 dp ("4.3", "-3.4"); null when a side is missing or suspended. */
export interface MarketChanges {
  momPct: string | null;
  ytdPct: string | null;
  yoyPct: string | null;
}

/** A month the item was priced in, and the price. */
export interface MarketPricedMonth {
  month: string;
  price: string;
}

/** The names the price-book seed gives a market item, in each language. */
export interface MarketSeededNames {
  nameAr: string;
  nameEn: string;
}

/** The studio's own price-book item linked to a market item (RLS: this studio's only). */
interface LinkedCostItem {
  id: string;
  code: string;
}

export interface MarketItemRow extends MarketChanges {
  id: string;
  key: string;
  categoryKey: string;
  nameAr: string;
  nameEn: string;
  specAr: string | null;
  specEn: string | null;
  unit: MarketUnit;
  unitLabelAr: string;
  basisNoteAr: string | null;
  status: MarketItemStatus;
  /** The newest month of `series`, priced or suspended. */
  latest: MarketPoint | null;
  /** At most 13 months, ascending, ending at the newest published bulletin's month. */
  series: MarketPoint[];
  /** The newest priced month of the item's WHOLE history (it may be older than `series`): the cost an add saves. */
  latestPriced: MarketPricedMonth | null;
  /** How the seed names it (and so how an add names it); null only before the seed book is built. */
  seededNames: MarketSeededNames | null;
  linkedCostItem: LinkedCostItem | null;
}

/** One item for the drawer: the row, and every effective month (newest MARKET_DETAIL_MONTHS). */
export interface MarketItemDetail extends MarketItemRow {
  allPoints: MarketPoint[];
}

/** A top category (parentKey null) or one of its leaves; `itemCount` counts the items a studio can see. */
export interface MarketCategory {
  key: string;
  nameAr: string;
  nameEn: string;
  parentKey: string | null;
  itemCount: number;
}

/** The newest published bulletin, as the attribution names it. No file names, hashes or reviewer. */
export interface MarketBulletinSummary {
  periodMonth: string;
  publishedAt: string;
  collectionFromDay: number;
  collectionToDay: number;
  regionKey: string;
}

/** Everything /market-book shows, read in ONE statement (one snapshot). */
export interface MarketBookPage {
  bulletin: MarketBulletinSummary | null;
  categories: MarketCategory[];
  /** The leaf shown, or null for a search. */
  categoryKey: string | null;
  items: MarketItemRow[];
  /** How many items match, across every page. */
  matched: number;
  /** The page shown: the one asked for, or the last one when it asked past the end. */
  page: number;
}

/**
 * The price book's Market column for one linked cost item: the market item's
 * newest priced month (the figure the seed and an add use) and how far the
 * item's own cost is from it. Reference only; nothing is ever written from it.
 */
export interface MarketPriceRef {
  marketItemId: string;
  nameAr: string;
  nameEn: string;
  unit: MarketUnit;
  unitLabelAr: string;
  /** Null when no month was ever priced (or the item is no longer published). */
  price: string | null;
  month: string | null;
  variancePct: string | null;
  reason: MarketVarianceReason;
}

/** The Market column of one price book page: absent (null bulletin) until a bulletin is published. */
export interface PriceBookMarketColumn {
  bulletin: MarketBulletinSummary | null;
  /** By cost item id; only the page's linked items. */
  refs: Record<string, MarketPriceRef>;
}

/** A market item the link combobox offers: one whose studio unit is the cost item's own. */
interface MarketLinkOption {
  id: string;
  nameAr: string;
  nameEn: string;
  leafNameAr: string;
  leafNameEn: string;
  /** The seed book's cost (its newest priced month); null when never priced. */
  unitCost: string | null;
}

export interface MarketLinkSearch {
  items: MarketLinkOption[];
  /** More items matched than the answer carries: typing more narrows it. */
  more: boolean;
}
