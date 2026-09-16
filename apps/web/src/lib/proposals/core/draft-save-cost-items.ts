import 'server-only';
// Stage 2a of the draft save: one lookup for every price-book item the payload
// references.
//
// ONE query for the whole document, never one per line: a fit-out proposal quotes
// hundreds of lines off the price book, and a per-line lookup is the difference
// between one round trip and three hundred inside an open transaction.
import { costItems, type CostItemUnit, type MetraDb } from '@metra/db';
import { inArray } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import type { SectionInput } from './types';

/** The price-book fields a draft line may inherit. */
export interface CostItemResolved {
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  nameEn: string | null;
  nameAr: string | null;
}

/**
 * Every referenced cost item, keyed by id — and a coded refusal if any of them is
 * missing or retired.
 *
 * The RLS transaction is the tenancy boundary, so an id from another org simply
 * does not come back; the `has` check below is what turns that into `invalid`
 * rather than into a line silently priced at zero.
 */
export async function loadCostItemMap(
  tx: MetraDb,
  sections: SectionInput[],
): Promise<Map<string, CostItemResolved>> {
  const costItemIds = [
    ...new Set(
      sections.flatMap((section) =>
        section.lines
          .map((line) => line.costItemId?.trim())
          .filter((id): id is string => !!id),
      ),
    ),
  ];
  const costItemMap = new Map<string, CostItemResolved>();
  if (!costItemIds.length) return costItemMap;

  const costItemRows = await tx
    .select()
    .from(costItems)
    .where(inArray(costItems.id, costItemIds));
  for (const costItem of costItemRows) {
    if (!costItem.active) fail('invalid');
    costItemMap.set(costItem.id, costItem);
  }
  for (const costItemId of costItemIds) {
    if (!costItemMap.has(costItemId)) fail('invalid');
  }
  return costItemMap;
}
