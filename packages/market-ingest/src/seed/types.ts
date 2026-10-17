// The shapes the price-book seed plans with: the published market items, what
// a studio already has, and what the plan creates and skips.
import type { CostItemUnit, MarketUnit } from '@metra/db/schema';
import type { RollPack } from '../roll-pack';

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
