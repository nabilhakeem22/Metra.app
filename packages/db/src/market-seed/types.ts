// The shapes the price-book seed plans with: the published market items, the
// seed book built from them once per published book, what a studio already
// has, and what one studio's plan creates and skips.
import type { CostItemUnit, MarketUnit } from '../schema/enums';

/** A roll's pack size, read off its printed unit label (packages/market-ingest/src/roll-pack.ts). */
export interface RollPack {
  /** One continuous length, in metres: «اللفة (100 م.ط)» = 100. */
  lengthM: number | null;
  /** A bundle of pieces: «لفة 34×3م» = 34 pieces ... */
  pieces: number | null;
  /** ... each this long, in metres (3). */
  pieceLengthM: number | null;
}

export interface MarketSeedItem {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  specAr: string | null;
  specEn: string | null;
  unit: MarketUnit;
  pack: RollPack | null;
  status: 'active' | 'discontinued';
  leafKey: string;
  leafNameAr: string;
  leafNameEn: string;
  topNameAr: string;
  topNameEn: string;
  /** The newest published month with a numeric price, or null when there is none. */
  latestPrice: string | null;
}

/** The sub-category an item sits in, and its category: what a studio section is named from. */
export interface SeedLeaf {
  leafKey: string;
  leafNameAr: string;
  leafNameEn: string;
  topNameAr: string;
  topNameEn: string;
}

/**
 * One market item as EVERY studio's seed reads it: the studio-independent half
 * of the plan (./book.ts), built once per published book, so one studio's plan
 * is set lookups only.
 */
export interface SeedBookEntry extends SeedLeaf {
  marketItemId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  /** The comparison forms a studio's own item clashes with: the seeded names and the bulletin's printed spellings. */
  nameForms: string[];
  status: 'active' | 'discontinued';
  /** The studio unit, or null when none fits (bag, pack, thousand_bricks). */
  unit: CostItemUnit | null;
  /** Cost and selling price at the price-book scale, or null when no month has a numeric price. */
  unitCost: string | null;
  unitPrice: string | null;
}

export interface StudioBook {
  sections: Array<{ id: string; key: string | null; nameAr: string | null; nameEn: string | null }>;
  items: Array<{ code: string; nameAr: string | null; nameEn: string | null; marketItemId: string | null }>;
}

export const SKIP_REASONS = ['already_linked', 'discontinued', 'unit_unsupported', 'no_price', 'code_clash', 'name_clash'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface SectionToCreate {
  key: string;
  nameAr: string;
  nameEn: string;
  /** True when the plain sub-category name was already taken, so it carries its category. */
  qualified: boolean;
}

export interface ItemToCreate {
  marketItemId: string;
  /** A section this plan creates (by key), or a section the studio already has (by id). */
  section: { key: string } | { id: string };
  code: string;
  nameAr: string;
  nameEn: string;
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
}

export interface SeedPlan {
  /** Existing sections the seed's items go to (made by an earlier seed, or of the same name). */
  sectionsPresent: number;
  sectionsToCreate: SectionToCreate[];
  itemsToCreate: ItemToCreate[];
  skipped: Record<SkipReason, number>;
}
