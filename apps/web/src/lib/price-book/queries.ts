import 'server-only';
import { costItems, type CostItem } from '@metra/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ListCostItemsFilter {
  active?: boolean;
}

/**
 * EVERY org-scoped cost item (or every active one), ordered by section then
 * code. For a file (the BOQ template) and for tests: a page lists one page of
 * the book (page-query.ts), never this.
 */
export function listCostItems(
  ctx: OrgContext,
  filter: ListCostItemsFilter = {},
): Promise<CostItem[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(costItems)
      .where(filter.active === undefined ? undefined : eq(costItems.active, filter.active))
      .orderBy(asc(costItems.sectionId), asc(costItems.code)),
  );
}

/** Which of `codes` the studio's price book already holds (case-SENSITIVE, as unique(org_id, code) is). */
export async function existingCodesAmong(ctx: OrgContext, codes: readonly string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const found = await withOrgContext(ctx, (tx) =>
    tx.select({ code: costItems.code }).from(costItems).where(inArray(costItems.code, [...codes])),
  );
  return found.map((row) => row.code);
}
